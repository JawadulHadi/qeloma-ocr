import { normalizeText } from './text';

/** Groups whose content is formatting, metadata or embedded data rather than document text. */
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'fldinst', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl',
  'generator', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'filetbl', 'revtbl', 'pgdsctbl',
  'operator', 'nonshppict', 'bkmkstart', 'bkmkend', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'mmathPr',
]);

const SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  tab: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
};

/** Windows-1252 bytes 0x80–0x9F; every other byte maps to the same Unicode code point. */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

function cp1252(byte: number): string {
  return byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : String.fromCharCode(byte);
}

interface GroupState {
  skip: boolean;
  /** Fallback characters that follow each \uN (set by \ucN). */
  uc: number;
}

/** Converts an RTF document to plain text. Tables become "cell | cell" rows. */
export function rtfToText(rtf: string): string {
  const out: string[] = [];
  const stack: GroupState[] = [];
  let state: GroupState = { skip: false, uc: 1 };
  /** Fallback characters still to drop after a \uN. */
  let pendingSkip = 0;
  /** True right after "{": a control word here may name the group's destination. */
  let groupStart = false;
  let i = 0;

  const emit = (text: string) => {
    if (pendingSkip > 0) {
      pendingSkip -= 1;
      return;
    }
    if (!state.skip) out.push(text);
  };

  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push(state);
      state = { ...state };
      groupStart = true;
      pendingSkip = 0;
      i += 1;
      continue;
    }
    if (ch === '}') {
      state = stack.pop() ?? { skip: false, uc: 1 };
      groupStart = false;
      pendingSkip = 0;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch !== '\\') {
      groupStart = false;
      emit(ch);
      i += 1;
      continue;
    }

    // A control symbol or control word.
    const next = rtf[i + 1] ?? '';
    if (next === '\\' || next === '{' || next === '}') {
      emit(next);
      i += 2;
      groupStart = false;
      continue;
    }
    if (next === "'") {
      const byte = Number.parseInt(rtf.slice(i + 2, i + 4), 16);
      if (!Number.isNaN(byte)) emit(cp1252(byte));
      i += 4;
      groupStart = false;
      continue;
    }
    if (next === '*') {
      if (groupStart) state.skip = true;
      i += 2;
      continue;
    }
    if (next === '~') emit(' ');
    else if (next === '_') emit('-');
    else if (next === '\n' || next === '\r') emit('\n');
    if (!/[a-z]/i.test(next)) {
      // \- (optional hyphen), \| and other symbols carry no text.
      i += 2;
      groupStart = false;
      continue;
    }

    const match = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1, i + 40));
    if (!match) {
      i += 1;
      continue;
    }
    const word = match[1];
    const param = match[2] === undefined ? null : Number(match[2]);
    i += 1 + match[0].length;

    if (groupStart && SKIPPED_DESTINATIONS.has(word)) state.skip = true;
    groupStart = false;

    if (word === 'bin' && param !== null) {
      i += Math.max(0, param);
    } else if (word === 'uc' && param !== null) {
      state.uc = Math.max(0, param);
    } else if (word === 'u' && param !== null) {
      const code = param < 0 ? param + 65536 : param;
      pendingSkip = 0;
      if (!state.skip) out.push(String.fromCharCode(code));
      pendingSkip = state.uc;
    } else if (word === 'cell') {
      emit(' | ');
    } else if (word === 'row') {
      if (!state.skip) {
        if (out.at(-1) === ' | ') out.pop();
        out.push('\n');
      }
    } else if (word in SYMBOLS) {
      emit(SYMBOLS[word]);
    }
  }

  return normalizeText(out.join(''));
}
