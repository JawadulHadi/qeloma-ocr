// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnIndex, docxToPages, epubToPages, odsToPages, odtToPages, pptxToPages, xlsxToPages } from './office';

const zip = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const ODF =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';

describe('docx', () => {
  it('reads paragraphs, tabs, breaks, tables and footnotes in order, skipping deleted text', () => {
    const { pages } = docxToPages(
      zip({
        'word/document.xml': `<w:document ${W}><w:body>
          <w:p><w:r><w:t>Notice</w:t></w:r></w:p>
          <w:p><w:r><w:t>Rent</w:t><w:tab/><w:t>Rs 85,000</w:t><w:br/><w:t>from December</w:t></w:r><w:del><w:r><w:delText>old</w:delText></w:r></w:del></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Deposit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Rs 170,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:r><w:t>End</w:t></w:r></w:p>
        </w:body></w:document>`,
        'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:type="separator" w:id="0"><w:p><w:r><w:t>---</w:t></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Subject to approval.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
      }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toBe(
      'Notice\nRent\tRs 85,000\nfrom December\nDeposit | Rs 170,000\n\nEnd\n\nNotes\n1. Subject to approval.',
    );
  });
});

describe('pptx', () => {
  const slide = (text: string) => `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  it('orders slides numerically when there is no slide list', () => {
    const { pages } = pptxToPages(
      zip({ 'ppt/slides/slide10.xml': slide('Ten'), 'ppt/slides/slide2.xml': slide('Two'), 'ppt/slides/slide1.xml': slide('One') }),
    );
    expect(pages.map((page) => page.text)).toEqual(['One', 'Two', 'Ten']);
  });

  it('follows the presentation order when it is given', () => {
    const { pages } = pptxToPages(
      zip({
        'ppt/presentation.xml': `<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
        'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>`,
        'ppt/slides/slide1.xml': slide('First file'),
        'ppt/slides/slide2.xml': slide('Shown first'),
      }),
    );
    expect(pages.map((page) => page.text)).toEqual(['Shown first', 'First file']);
  });
});

describe('xlsx', () => {
  it('reads shared, inline, boolean and number cells per sheet, keeping column gaps', () => {
    const { pages, warnings } = xlsxToPages(
      zip({
        'xl/workbook.xml': `<workbook ${S}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
        'xl/sharedStrings.xml': `<sst ${S}><si><t>Item</t></si><si><r><t>Gro</t></r><r><t>ceries</t></r></si></sst>`,
        'xl/worksheets/sheet1.xml': `<worksheet ${S}><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="b"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>32500</v></c></row>
        </sheetData></worksheet>`,
        'xl/worksheets/sheet2.xml': `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Paid in full</t></is></c></row></sheetData></worksheet>`,
      }),
    );
    expect(warnings).toEqual([]);
    expect(pages.map((page) => page.text)).toEqual(['Sheet: Budget\nItem\t\tTRUE\nGroceries\t32500', 'Sheet: Notes\nPaid in full']);
  });

  it('turns cell references into column numbers', () => {
    expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA3'), columnIndex('ab12')]).toEqual([0, 25, 26, 27]);
  });
});

describe('OpenDocument', () => {
  it('reads odt headings, spaces, tabs, line breaks, lists and tables', () => {
    const { pages } = odtToPages(
      zip({
        'content.xml': `<office:document-content ${ODF}><office:body><office:text>
          <text:h>Lease</text:h>
          <text:p>Rent<text:s text:c="2"/>due<text:tab/>monthly<text:line-break/>in advance</text:p>
          <text:list><text:list-item><text:p>Keep pets out</text:p></text:list-item></text:list>
          <table:table><table:table-row><table:table-cell><text:p>Deposit</text:p></table:table-cell><table:table-cell><text:p>2 months</text:p></table:table-cell></table:table-row></table:table>
        </office:text></office:body></office:document-content>`,
      }),
    );
    expect(pages[0].text).toBe('Lease\nRent  due\tmonthly\nin advance\n• Keep pets out\nDeposit | 2 months');
  });

  it('expands repeated ods cells and rows but ignores trailing empty columns', () => {
    const { pages } = odsToPages(
      zip({
        'content.xml': `<office:document-content ${ODF}><office:body><office:spreadsheet>
          <table:table table:name="Costs">
            <table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16000"/></table:table-row>
            <table:table-row table:number-rows-repeated="1000000"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
          </table:table>
        </office:spreadsheet></office:body></office:document-content>`,
      }),
    );
    expect(pages[0].text).toBe('Sheet: Costs\nx\tx\nx\tx');
  });
});

describe('epub', () => {
  it('reads chapters in spine order, skipping non-linear items', () => {
    const { pages } = epubToPages(
      zip({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml': `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`,
        'OEBPS/book.opf': `<package xmlns="http://www.idpf.org/2007/opf"><manifest>
            <item id="c1" href="text/one.xhtml"/><item id="c2" href="text/two%20b.xhtml"/><item id="nav" href="nav.xhtml"/>
          </manifest><spine><itemref idref="c2"/><itemref idref="nav" linear="no"/><itemref idref="c1"/></spine></package>`,
        'OEBPS/text/one.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>First chapter.</p></body></html>`,
        'OEBPS/text/two b.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Second <b>chapter</b>.</p></body></html>`,
        'OEBPS/nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Contents</p></body></html>`,
      }),
    );
    expect(pages.map((page) => page.text)).toEqual(['Second chapter.', 'One\n\nFirst chapter.']);
  });
});

it('reports damaged archives in plain language', () => {
  expect(() => docxToPages(new Uint8Array([1, 2, 3]))).toThrow("This file couldn't be opened. It may be damaged.");
});
