// End-to-end check of the production build in a real browser (Playwright Chromium).
//
//   npm run build && npm run test:e2e          # against dist/ via `vite preview`
//   npm run test:e2e -- --headed               # watch it run
//
// The /api routes are mocked in the browser (a signed-in user, a canned analysis, a chat answer), so no Google
// or Gemini keys are needed. Extraction is real: OCR, pdf.js and the Office parsers run exactly as in production.
// On-device OCR downloads tesseract's engine and language data from jsDelivr on first use, so this needs a network.
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { generateFixtures } from './fixtures.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = join(ROOT, 'e2e', '.artifacts');
const headed = process.argv.includes('--headed');

const USER = { id: 'e2e-user', email: 'reader@example.com', name: 'Test Reader', picture: null };

/** A canned analysis that cites every source it was given, like the real one does. */
function analysisFor(labels) {
  const all = labels.map((label) => `[${label}]`).join('');
  return {
    title: labels.length > 1 ? `Sample set of ${labels.length}` : 'Sample document',
    documentType: 'Bill',
    language: 'English',
    summary: `A sample used by the end-to-end test ${all}.`,
    keyFactors: [{ label: 'Due date', detail: `Pay by 14 October 2026 [${labels[0]}].`, importance: 'high' }],
    keyPoints: [`The amount due is Rs 14,230 [${labels[0]}].`],
    solutions: [
      { title: 'Pay online', description: 'Pay before the due date.', steps: ['Open the portal', 'Pay'], source: 'document' },
    ],
    openQuestions: ['Is the meter reading correct?'],
    caveats: [],
  };
}

/** Mocks /api for a signed-in user and records what the page asked the AI. */
async function mockApi(page, calls) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    switch (path) {
      case '/api/auth/config':
        return json({ googleClientId: null, aiConfigured: true, model: 'gemini-e2e', drive: null, oneDrive: null });
      case '/api/auth/me':
        return json({ user: USER });
      case '/api/auth/logout':
        return route.fulfill({ status: 204 });
      case '/api/analyze': {
        const labels = body.sources.map((source) => source.label);
        calls.analyze.push(labels);
        return json({ analysis: analysisFor(labels), model: 'gemini-e2e', truncated: false });
      }
      case '/api/vision':
        return json({ text: 'Text read by the mocked AI vision.', model: 'gemini-e2e' });
      case '/api/chat':
        calls.chat.push(body);
        return route.fulfill({
          status: 200,
          contentType: 'text/plain; charset=utf-8',
          body: `Pay **before 14 October** to avoid the late fee [${body.sources[0].label}].`,
        });
      default:
        return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    }
  });
}

/** Each fixture and the text that must come out of it ("error:" = the upload must be refused with this text). */
const CASES = [
  ['bill.png', ['amount', 'october']],
  ['bill.jpg', ['amount', 'october']],
  ['bill.webp', ['amount', 'october']],
  ['bill.bmp', ['amount', 'october']],
  ['bill.tif', ['amount', 'october']],
  ['invoice.pdf', ['invoice 2026-0915', 'total payable', 'amount']],
  ['tenancy.docx', ['rent rises to rs 85,000 from 1 december 2026.', 'deposit | rs 170,000']],
  ['budget.xlsx', ['groceries', 'school fees', '41000']],
  ['review.pptx', ['quarterly review', 'revenue grew 18 percent']],
  ['notes.txt', ['fix the boiler']],
  ['readme.md', ['warranty covers parts']],
  ['expenses.csv', ['internet,4500']],
  ['page.html', ['refunds are issued within 14 days.']],
  ['letter.rtf', ['claim number is 55-102']],
  ['legacy.doc', ['error:older .doc']],
];

const ON_DEVICE = JSON.stringify({ mode: 'local', language: 'eng', reviewBeforeAnalysis: false });

/** A fresh, empty workspace reading on the device only: deterministic and offline-safe for the AI part. */
async function freshWorkspace(page, url) {
  await page.goto(url);
  await page.evaluate((prefs) => localStorage.setItem('scanwise.prefs', prefs), ON_DEVICE);
  await page.reload();
  await page.locator('.dropzone').waitFor();
}

async function readFixture(page, url, file, expected) {
  await freshWorkspace(page, url);
  await page.locator('input[type=file]').setInputFiles(file);

  const wantsError = expected[0].startsWith('error:');
  if (wantsError) {
    const alert = page.locator('.upload-error');
    await alert.waitFor({ timeout: 30_000 });
    const text = (await alert.innerText()).toLowerCase();
    const needle = expected[0].slice('error:'.length);
    return text.includes(needle) ? [] : [`expected an error containing "${needle}", got: ${text}`];
  }

  // Ready = the canned analysis is on screen; then open the source to check its text.
  await page.locator('.report-title').first().waitFor({ timeout: 240_000 });
  await page.locator('.source-open').first().click();
  const docText = (await page.locator('#doc-text').innerText()).toLowerCase();
  return expected.filter((needle) => !docText.includes(needle)).map((needle) => `missing "${needle}"`);
}

/** Runs one named check; returns the failure count. */
async function check(name, page, screens, run) {
  try {
    const problem = await run();
    if (problem) throw new Error(problem);
    console.log(`  ok    ${name}`);
    return 0;
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    await page.screenshot({ path: join(screens, `fail-${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
    return 1;
  }
}

/** Asks a suggested question: the answer renders as Markdown with a citation chip that opens its source. */
async function checkChat(page, screens) {
  return check('chat answer with a citation', page, screens, async () => {
    await page.locator('.viewer-back').click();
    await page.locator('.suggestion').first().click();
    await page.locator('.msg-assistant strong', { hasText: 'before 14 October' }).waitFor({ timeout: 15_000 });
    await page.locator('.msg-assistant .cite', { hasText: 'S1' }).click();
    await page.locator('.viewer #doc-text').waitFor({ timeout: 5_000 });
  });
}

/** Selects a passage in the open source, quotes it into the chat and asks about it. */
async function checkQuote(page, screens, calls) {
  return check('quote a passage in the chat', page, screens, async () => {
    await page.evaluate(() => {
      const target = document.querySelector('#doc-text .doc-text, #doc-text .doc-page');
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.locator('.quote-float').click();
    await page.locator('.composer-quote .quote-text').waitFor();
    const asked = calls.chat.length;
    await page.locator('#chat-question').fill('Is this right?');
    await page.locator('.composer-send').click();
    await page.locator('.msg-user .quote').last().waitFor({ timeout: 10_000 });
    for (let tries = 0; calls.chat.length === asked && tries < 50; tries++) await page.waitForTimeout(100);
    const sent = calls.chat.at(-1)?.question ?? '';
    if (!/^> [\s\S]*\[S1\]\n\nIs this right\?$/.test(sent)) return `the question sent was: ${JSON.stringify(sent)}`;
    return null;
  });
}

/** Several files at once, a ZIP of two more, and pasted text: every one becomes a labelled source. */
async function checkSources(page, url, fixtures, screens, calls) {
  let failures = 0;
  await freshWorkspace(page, url);
  failures += await check('several files at once', page, screens, async () => {
    await page.locator('input[type=file]').setInputFiles([fixtures['notes.txt'], fixtures['readme.md'], fixtures['expenses.csv']]);
    await page.locator('.report-title', { hasText: 'Sample set of 3' }).waitFor({ timeout: 60_000 });
    const labels = await page.locator('.source-row .source-label').allInnerTexts();
    if (labels.join(',') !== 'S1,S2,S3') return `labels were ${labels.join(',')}`;
    if (calls.analyze.at(-1)?.join(',') !== 'S1,S2,S3') return `analyzed ${calls.analyze.at(-1)}`;
    return null;
  });
  failures += await check('a .zip becomes one source per document', page, screens, async () => {
    await page.getByRole('button', { name: 'Add sources' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Upload files/ }).click();
    await (await chooser).setFiles(fixtures['bundle.zip']);
    await page.locator('.source-row:not(.is-reading)').nth(4).waitFor({ timeout: 30_000 });
    const names = await page.locator('.source-row .source-file').allInnerTexts();
    if (names.length !== 5 || !names.includes('lease-letter.txt') || !names.includes('water-bill.md')) {
      return `sources were ${names.join(', ')}`;
    }
    return null;
  });
  failures += await check('pasted text becomes a source', page, screens, async () => {
    await page.getByRole('button', { name: 'Add sources' }).click();
    await page.getByRole('button', { name: 'Paste text' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Landlord email');
    await page.getByLabel('Text', { exact: true }).fill('The boiler will be replaced on Monday.');
    await page.getByRole('button', { name: 'Add as a source' }).click();
    await page.locator('.source-file', { hasText: 'Landlord email.txt' }).waitFor({ timeout: 15_000 });
    const label = await page.locator('.source-row', { hasText: 'Landlord email' }).locator('.source-label').innerText();
    return label === 'S6' ? null : `the pasted source was labelled ${label}`;
  });
  failures += await check('untick a source, then update the summary', page, screens, async () => {
    await page.locator('.stale').waitFor({ timeout: 5_000 });
    await page.getByRole('checkbox', { name: /Use S2,/ }).uncheck();
    await page.getByRole('button', { name: 'Update summary' }).click();
    await page.locator('.report-title', { hasText: 'Sample set of 5' }).waitFor({ timeout: 15_000 });
    const sent = calls.analyze.at(-1)?.join(',');
    if (sent !== 'S1,S3,S4,S5,S6') return `analyzed ${sent}`;
    if (await page.locator('.stale').count()) return 'the summary still says it is out of date';
    return null;
  });
  failures += await check('voice input button', page, screens, async () => {
    const mic = page.getByRole('button', { name: 'Speak your question' });
    return (await mic.count()) === 1 ? null : 'no microphone button in the chat box';
  });
  await page.screenshot({ path: join(screens, 'sources-desktop.png') });
  return failures;
}

/**
 * Signed out, with sign-in not configured (a fresh deploy): "Upload a document" must still reach the upload
 * screen, read a file on the device, and ask for a sign-in instead of calling the AI. Returns the failure count.
 */
async function checkGuest(browser, url, file, screens) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const aiCalls = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/config') {
      return json({ googleClientId: null, aiConfigured: false, model: 'gemini-e2e', drive: null, oneDrive: null });
    }
    if (path === '/api/auth/me') return json({ error: { code: 'unauthorized', message: 'Sign in first.' } }, 401);
    aiCalls.push(path);
    return json({ error: { code: 'unauthorized', message: 'Sign in first.' } }, 401);
  });
  const failures = await check('upload without sign-in', page, screens, async () => {
    await page.goto(url);
    await page.getByRole('button', { name: 'Upload a document' }).click();
    await page.locator('input[type=file]').setInputFiles(file);
    await page.locator('.signin-callout').waitFor({ timeout: 30_000 });
    await page.locator('.source-open').first().click();
    const docText = (await page.locator('#doc-text').innerText()).toLowerCase();
    await page.screenshot({ path: join(screens, 'guest-workspace.png') });
    if (!docText.includes('fix the boiler')) return 'the text was not read';
    if (aiCalls.length > 0) return `called ${aiCalls.join(', ')} without a sign-in`;
    if (await page.locator('.quote-float, #chat-question').count()) return 'chat tools showed without a sign-in';
    return null;
  });
  await context.close();
  return failures;
}

/** Screenshots the page and fails when it scrolls sideways. Returns the failure count. */
async function checkNoSideScroll(page, path) {
  const width = page.viewportSize()?.width;
  // Let media-query listeners re-render after a viewport change before measuring.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path, fullPage: true });
  if (overflow > 0) {
    console.log(`  FAIL  ${width}px layout scrolls sideways by ${overflow}px`);
    return 1;
  }
  console.log(`  ok    ${width}px layout has no sideways scroll`);
  return 0;
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('No build found. Run `npm run build` first.');
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: !headed });
  const fixtures = await generateFixtures(browser, join(OUT, 'fixtures'));
  const server = await preview({ root: ROOT, preview: { port: 4317, strictPort: false, open: false }, logLevel: 'error' });
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4317/';
  const screens = join(OUT, 'screens');
  await mkdir(screens, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const calls = { analyze: [], chat: [] };
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await mockApi(page, calls);

  let failures = await checkGuest(browser, url, fixtures['notes.txt'], screens);
  for (const [name, expected] of CASES) {
    const started = Date.now();
    let problems;
    try {
      problems = await readFixture(page, url, fixtures[name], expected);
    } catch (err) {
      problems = [err instanceof Error ? err.message.split('\n')[0] : String(err)];
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (problems.length === 0) {
      console.log(`  ok    ${name} (${seconds}s)`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${name} (${seconds}s): ${problems.join('; ')}`);
      await page.screenshot({ path: join(screens, `fail-${name}.png`), fullPage: true });
    }
    // The PDF leaves a full workspace on screen: check chat, citations, quoting and the phone layout there.
    if (name === 'invoice.pdf' && problems.length === 0) {
      await page.screenshot({ path: join(screens, 'workspace-desktop.png') });
      failures += await checkChat(page, screens);
      failures += await checkQuote(page, screens, calls);
      await page.setViewportSize({ width: 360, height: 780 });
      failures += await checkNoSideScroll(page, join(screens, 'workspace-phone.png'));
      await page.setViewportSize({ width: 1360, height: 900 });
    }
  }

  // The last case leaves the upload screen with an error showing.
  await page.setViewportSize({ width: 360, height: 780 });
  failures += await checkNoSideScroll(page, join(screens, 'upload-phone.png'));
  await page.setViewportSize({ width: 1360, height: 900 });

  failures += await checkSources(page, url, fixtures, screens, calls);
  await page.setViewportSize({ width: 360, height: 780 });
  failures += await checkNoSideScroll(page, join(screens, 'sources-phone.png'));

  if (pageErrors.length > 0) {
    failures += 1;
    console.log(`  FAIL  uncaught page errors:\n    ${pageErrors.join('\n    ')}`);
  }

  await browser.close();
  await server.close();
  console.log(failures === 0 ? '\nAll end-to-end checks passed.' : `\n${failures} end-to-end check(s) failed. Screenshots: ${screens}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
