/** Rebuilds readable lines from pdf.js text items. Kept free of pdf.js imports so it can be unit-tested. */

export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, x, y] — x and y are the item's baseline origin in PDF units (y grows upwards). */
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

export function isTextItem<T>(item: T): item is T & PdfTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

/**
 * Joins items into lines: a new line starts after an explicit end-of-line or when the baseline moves by
 * more than half a line; items on one line get a space between them when there is a visible gap.
 */
export function textItemsToText(items: PdfTextItem[]): string {
  let text = '';
  let previous: PdfTextItem | null = null;
  for (const item of items) {
    if (previous && !previous.hasEOL && item.str) {
      const size = Math.max(item.height, previous.height, 1);
      const dy = Math.abs(item.transform[5] - previous.transform[5]);
      if (dy > size * 0.5) {
        text += '\n';
      } else {
        const gap = item.transform[4] - (previous.transform[4] + previous.width);
        if (gap > size * 0.15 && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
      }
    }
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (item.str || item.hasEOL) previous = item;
  }
  return text;
}
