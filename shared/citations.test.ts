import { describe, expect, it } from 'vitest';
import { splitCitations, stripUnknownCitations } from './citations.js';

describe('splitCitations', () => {
  it('finds single and grouped labels', () => {
    expect(splitCitations('Pay by Friday [S1]. Rent rises [S2, S3].')).toEqual([
      { type: 'text', text: 'Pay by Friday ' },
      { type: 'cite', labels: ['S1'] },
      { type: 'text', text: '. Rent rises ' },
      { type: 'cite', labels: ['S2', 'S3'] },
      { type: 'text', text: '.' },
    ]);
  });

  it('leaves other brackets alone', () => {
    expect(splitCitations('See [note] and [S0] and [s1].')).toEqual([{ type: 'text', text: 'See [note] and [S0] and [s1].' }]);
  });
});

describe('stripUnknownCitations', () => {
  const known = new Set(['S1', 'S2']);

  it('keeps known labels and drops invented ones', () => {
    expect(stripUnknownCitations('Due soon [S1]. Fee [S9]. Both [S2; S7].', known)).toBe('Due soon [S1]. Fee. Both [S2].');
  });
});
