// Generates one fixture per supported file family into e2e/.artifacts/fixtures.
// Images are rendered by a real browser so OCR has something realistic to read.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import UTIF from 'utif2';

export const FIXTURE_TEXT = {
  heading: 'ELECTRICITY BILL',
  account: 'Account 4471 0923',
  amount: 'Amount due Rs 14,230',
  due: 'Due date 14 October 2026',
};

const DOC_HTML = `<!doctype html><html><body style="margin:0;background:#fff">
<div id="doc" style="width:900px;padding:48px 56px;font:34px/1.5 Arial, sans-serif;color:#111;background:#fff">
  <div style="font-weight:700;font-size:44px;margin-bottom:18px">${FIXTURE_TEXT.heading}</div>
  <div>${FIXTURE_TEXT.account}</div>
  <div>${FIXTURE_TEXT.amount}</div>
  <div>${FIXTURE_TEXT.due}</div>
  <div>Late fee Rs 500 after the due date</div>
</div></body></html>`;

/** Renders the sample document in the browser and returns PNG, JPEG, WebP bytes and raw RGBA. */
async function renderImages(browser) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(DOC_HTML);
  const el = page.locator('#doc');
  const png = await el.screenshot({ type: 'png' });
  const jpeg = await el.screenshot({ type: 'jpeg', quality: 92 });
  const { webp, rgba, width, height } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const webpUrl = c.toDataURL('image/webp', 0.95);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let bin = '';
    for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { webp: webpUrl.split(',')[1], rgba: btoa(bin), width: c.width, height: c.height };
  }, png.toString('base64'));
  await page.close();
  return {
    png,
    jpeg,
    webp: Buffer.from(webp, 'base64'),
    rgba: new Uint8Array(Buffer.from(rgba, 'base64')),
    width,
    height,
  };
}

function encodeBmp(rgba, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      buf[row + x * 3] = rgba[s + 2];
      buf[row + x * 3 + 1] = rgba[s + 1];
      buf[row + x * 3 + 2] = rgba[s];
    }
  }
  return buf;
}

/** Minimal PDF: page 1 has a real text layer, page 2 is a scanned JPEG with no text. */
function buildPdf(jpeg, jpegWidth, jpegHeight) {
  const text = [
    'BT /F1 20 Tf 72 720 Td (INVOICE 2026-0915) Tj',
    '0 -30 Td (Customer: Areeba Khan) Tj',
    '0 -30 Td (Total payable: 48,900) Tj',
    '0 -30 Td (Pay within 30 days to avoid a 2% surcharge) Tj ET',
  ].join('\n');
  const imgContent = `q 540 0 0 ${Math.round((540 * jpegHeight) / jpegWidth)} 36 300 cm /Im1 Do Q`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    { dict: '', stream: Buffer.from(text, 'latin1') },
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',
    { dict: '', stream: Buffer.from(imgContent, 'latin1') },
    {
      dict: `/Type /XObject /Subtype /Image /Width ${jpegWidth} /Height ${jpegHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      stream: jpeg,
    },
  ];
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(pos);
    let part;
    if (typeof obj === 'string') {
      part = Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
    } else {
      part = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n<< ${obj.dict} /Length ${obj.stream.length} >>\nstream\n`, 'latin1'),
        obj.stream,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    }
    chunks.push(part);
    pos += part.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function buildDocx() {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${w}><w:body>
      <w:p><w:r><w:t>Tenancy notice</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Rent rises to Rs 85,000 </w:t></w:r><w:r><w:t>from 1 December 2026.</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Deposit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rs 170,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>You may give one month of notice to leave.</w:t></w:r></w:p>
    </w:body></w:document>`),
  });
}

function buildXlsx() {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook ${ns}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst ${ns}><si><t>Item</t></si><si><t>Cost</t></si><si><t>Groceries</t></si></sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet ${ns}><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>32500</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>School fees</t></is></c><c r="B3"><v>41000</v></c></row>
    </sheetData></worksheet>`),
  });
}

function buildPptx() {
  const a = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const slide = (t) => strToU8(`<?xml version="1.0"?><p:sld ${a}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`),
    'ppt/presentation.xml': strToU8(`<?xml version="1.0"?><p:presentation ${a}/>`),
    'ppt/slides/slide1.xml': slide('Quarterly review'),
    'ppt/slides/slide2.xml': slide('Revenue grew 18 percent'),
  });
}

export async function generateFixtures(browser, outDir) {
  await mkdir(outDir, { recursive: true });
  const img = await renderImages(browser);
  const tiff = Buffer.from(UTIF.encodeImage(img.rgba, img.width, img.height));
  const files = {
    'bill.png': img.png,
    'bill.jpg': img.jpeg,
    'bill.webp': img.webp,
    'bill.bmp': encodeBmp(img.rgba, img.width, img.height),
    'bill.tif': tiff,
    'invoice.pdf': buildPdf(img.jpeg, img.width, img.height),
    'tenancy.docx': Buffer.from(buildDocx()),
    'budget.xlsx': Buffer.from(buildXlsx()),
    'review.pptx': Buffer.from(buildPptx()),
    'notes.txt': Buffer.from('Meeting notes\nThe landlord agreed to fix the boiler by Friday.\n', 'utf8'),
    'readme.md': Buffer.from('# Warranty\n\nThe warranty covers parts for **24 months**.\n', 'utf8'),
    'expenses.csv': Buffer.from('item,amount\nRent,85000\nInternet,4500\n', 'utf8'),
    'page.html': Buffer.from('<html><head><style>.x{}</style><script>var hidden=1</script></head><body><h1>Refund policy</h1><p>Refunds are issued within 14 days.</p></body></html>', 'utf8'),
    'letter.rtf': Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Dear customer,\\par Your claim number is 55-102.\\par}', 'latin1'),
    'legacy.doc': Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]),
  };
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(outDir, name), bytes);
  return Object.fromEntries(Object.keys(files).map((n) => [n, join(outDir, n)]));
}
