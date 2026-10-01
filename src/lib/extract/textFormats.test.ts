// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blocksToLines, linesToText, weightedConfidence } from './ocr';
import { textItemsToText, type PdfTextItem } from './pdfText';
import { rtfToText } from './rtf';
import { decodeText, htmlToText, normalizeText, textFileToText } from './text';

describe('rtfToText', () => {
  it('keeps text, paragraphs and tabs while skipping font tables and other destinations', () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0;}{\\*\\generator Word;}\\f0 Dear customer,\\par Claim\\tab 55-102\\par}';
    expect(rtfToText(rtf)).toBe('Dear customer,\nClaim\t55-102');
  });

  it('decodes hex and unicode escapes, dropping the fallback characters', () => {
    expect(rtfToText("{\\rtf1 caf\\'e9 \\'80 5 \\u8364? \\uc2\\u1575\\'c7\\'c7 x}")).toBe('café € 5 € ا x');
  });

  it('turns tables into rows and keeps escaped braces', () => {
    expect(rtfToText('{\\rtf1 \\{a\\} \\trowd A\\cell B\\cell\\row}')).toBe('{a} A | B');
  });
});

describe('text decoding', () => {
  it('honours BOMs and falls back to Windows-1252 for invalid UTF-8', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect(decodeText(utf16)).toBe('Hi');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  it('normalizes line endings, trailing spaces and blank runs', () => {
    expect(normalizeText('  a  \r\nb\t\r\n\r\n\r\n\r\nc\u0000 ')).toBe('a\nb\n\nc');
  });

  it('keeps visible HTML text only, with blocks on their own lines and table cells separated', () => {
    const html =
      '<html><head><style>.x{}</style><script>var hidden=1</script></head><body><h1>Refund policy</h1><p>Refunds are   issued <b>within 14 days</b>.</p><table><tr><td>Fee</td><td>Rs 500</td></tr></table><ul><li>One</li></ul></body></html>';
    expect(htmlToText(html)).toBe('Refund policy\n\nRefunds are issued within 14 days.\n\nFee | Rs 500\n\n• One');
  });

  it('pretty-prints valid JSON and leaves broken JSON alone', () => {
    expect(textFileToText('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
    expect(textFileToText('{"a":', 'application/json')).toBe('{"a":');
  });
});

describe('OCR result shaping', () => {
  const word = (text: string, confidence: number) => ({ text, confidence }) as never;
  const blocks = [
    {
      paragraphs: [
        { lines: [{ words: [word('Amount', 96), word('due', 90)] }, { words: [word(' ', 10)] }] },
        { lines: [{ words: [word('Rs', 40), word('14,230', 71.6)] }] },
      ],
    },
  ] as never;

  it('flattens blocks into lines, with an empty line between paragraphs', () => {
    const lines = blocksToLines(blocks);
    expect(lines).toEqual([
      { words: [{ text: 'Amount', confidence: 96 }, { text: 'due', confidence: 90 }] },
      { words: [] },
      { words: [{ text: 'Rs', confidence: 40 }, { text: '14,230', confidence: 72 }] },
    ]);
    expect(linesToText(lines)).toBe('Amount due\n\nRs 14,230');
    expect(blocksToLines(null)).toEqual([]);
  });

  it('weights page confidence by word length', () => {
    const lines = blocksToLines(blocks);
    // (96·6 + 90·3 + 40·2 + 72·6) / 17
    expect(weightedConfidence(lines)).toBe(80);
    expect(weightedConfidence([])).toBeNull();
  });
});

describe('PDF text layer', () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
    hasEOL,
  });

  it('rebuilds lines from baselines and end-of-line flags, adding spaces at visible gaps', () => {
    const text = textItemsToText([
      item('INVOICE', 72, 720, 60),
      item('2026-0915', 140, 720, 70, true),
      item('Total', 72, 690, 30),
      item('payable', 102, 690, 40),
      item('Pay', 72, 660, 20),
    ]);
    expect(text).toBe('INVOICE 2026-0915\nTotalpayable\nPay');
  });
});
