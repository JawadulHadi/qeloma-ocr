/**
 * Splits a character budget across several texts: short texts are kept whole and the rest share what is left
 * equally, so one long source can't crowd out the others. Returns how many characters of each text to keep,
 * in the same order. Shared by the browser (which trims before sending) and the server (which enforces it).
 */
export function shareBudget(lengths: readonly number[], budget: number): number[] {
  const allowed = lengths.map(() => 0);
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  let remaining = Math.max(0, Math.floor(budget));
  order.forEach(({ length, index }, position) => {
    const share = Math.floor(remaining / (order.length - position));
    allowed[index] = Math.min(length, share);
    remaining -= allowed[index];
  });
  return allowed;
}
