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

const ANALYSIS = {
  title: 'Sample document',
  documentType: 'Bill',
  language: 'English',
  summary: 'A sample document used by the end-to-end test.',
  keyFactors: [{ label: 'Due date', detail: 'Pay by 14 October 2026.', importance: 'high' }],
  keyPoints: ['The amount due is Rs 14,230.'],
  solutions: [
    { title: 'Pay online', description: 'Pay before the due date.', steps: ['Open the portal', 'Pay'], source: 'document' },
  ],
  openQuestions: ['Is the meter reading correct?'],
  caveats: [],
};

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

async function mockApi(page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    switch (path) {
      case '/api/auth/config':
        return json({ googleClientId: null, aiConfigured: true, model: 'gemini-e2e' });
      case '/api/auth/me':
        return json({ user: USER });
      case '/api/auth/logout':
        return route.fulfill({ status: 204 });
      case '/api/analyze':
        return json({ analysis: ANALYSIS, model: 'gemini-e2e', truncated: false });
      case '/api/vision':
        return json({ text: 'Text read by the mocked AI vision.', model: 'gemini-e2e' });
      case '/api/chat':
        return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'Pay **before 14 October** to avoid the late fee.' });
      default:
        return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
    }
  });
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
    if (path === '/api/auth/config') return json({ googleClientId: null, aiConfigured: false, model: 'gemini-e2e' });
    if (path === '/api/auth/me') return json({ error: { code: 'unauthorized', message: 'Sign in first.' } }, 401);
    aiCalls.push(path);
    return json({ error: { code: 'unauthorized', message: 'Sign in first.' } }, 401);
  });
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'Upload a document' }).click();
    await page.locator('input[type=file]').setInputFiles(file);
    await page.locator('.signin-callout').waitFor({ timeout: 30_000 });
    const docText = (await page.locator('#doc-text').innerText()).toLowerCase();
    await page.screenshot({ path: join(screens, 'guest-workspace.png') });
    const problems = [];
    if (!docText.includes('fix the boiler')) problems.push('the text was not read');
    if (aiCalls.length > 0) problems.push(`called ${aiCalls.join(', ')} without a sign-in`);
    if (problems.length > 0) {
      console.log(`  FAIL  upload without sign-in: ${problems.join('; ')}`);
      return 1;
    }
    console.log('  ok    upload without sign-in');
    return 0;
  } catch (err) {
    console.log(`  FAIL  upload without sign-in: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    await page.screenshot({ path: join(screens, 'fail-guest.png'), fullPage: true });
    return 1;
  } finally {
    await context.close();
  }
}

async function readFixture(page, url, file, expected) {
  await page.goto(url);
  // On-device only, and analyze straight away: deterministic and offline-safe for the AI part.
  await page.evaluate(() =>
    localStorage.setItem('scanwise.prefs', JSON.stringify({ mode: 'local', language: 'eng', reviewBeforeAnalysis: false })),
  );
  await page.reload();
  await page.locator('input[type=file]').setInputFiles(file);

  const wantsError = expected[0].startsWith('error:');
  if (wantsError) {
    const alert = page.locator('.upload-error');
    await alert.waitFor({ timeout: 30_000 });
    const text = (await alert.innerText()).toLowerCase();
    const needle = expected[0].slice('error:'.length);
    return text.includes(needle) ? [] : [`expected an error containing "${needle}", got: ${text}`];
  }

  // Ready = the canned analysis is on screen.
  await page.locator('.report-title').first().waitFor({ timeout: 240_000 });
  const docText = (await page.locator('#doc-text').innerText()).toLowerCase();
  return expected.filter((needle) => !docText.includes(needle)).map((needle) => `missing "${needle}"`);
}

/** Asks a suggested question and expects the mocked answer, rendered as Markdown. Returns the failure count. */
async function checkChat(page) {
  try {
    await page.locator('.suggestion').first().click();
    await page.locator('.msg-assistant strong', { hasText: 'before 14 October' }).waitFor({ timeout: 15_000 });
    console.log('  ok    chat answer');
    return 0;
  } catch (err) {
    console.log(`  FAIL  chat answer: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    return 1;
  }
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
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await mockApi(page);

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
    // The PDF leaves a full workspace on screen: check chat and the phone layout there.
    if (name === 'invoice.pdf' && problems.length === 0) {
      await page.screenshot({ path: join(screens, 'workspace-desktop.png') });
      failures += await checkChat(page);
      await page.setViewportSize({ width: 360, height: 780 });
      failures += await checkNoSideScroll(page, join(screens, 'workspace-phone.png'));
      await page.setViewportSize({ width: 1360, height: 900 });
    }
  }

  // The last case leaves the upload screen with an error showing.
  await page.setViewportSize({ width: 360, height: 780 });
  failures += await checkNoSideScroll(page, join(screens, 'upload-phone.png'));

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
