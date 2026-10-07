import { InvalidWordError } from './errors.js';

export const WORD_MIN_LENGTH = 2;
/** Longer words no longer fit the tornado canvas on a phone. */
export const WORD_MAX_LENGTH = 12;

// Lowercase latin letters (including French accents), digits, dot and hyphen.
const ALLOWED = /^[a-z0-9àâäçéèêëîïôöùûüÿœæ.-]+$/u;

/**
 * Minimal blocklist for the demo. Matching is done on the word stripped of
 * accents and separators so "c.o.n" or "côn" do not slip through.
 */
const BLOCKED = [
  'con',
  'conne',
  'connard',
  'merde',
  'pute',
  'salope',
  'encule',
  'nazi',
  'fuck',
  'shit',
];

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

export function normalizeWord(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase();
}

function skeleton(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[.-]/g, '');
}

/** Returns the normalized word, or throws InvalidWordError. */
export function validateWord(raw: string): string {
  const word = normalizeWord(raw);
  // Count what the visitor sees (graphemes), not UTF-16 code units.
  const length = [...graphemes.segment(word)].length;
  if (length < WORD_MIN_LENGTH || length > WORD_MAX_LENGTH) {
    throw new InvalidWordError('length');
  }
  if (!ALLOWED.test(word)) {
    throw new InvalidWordError('characters');
  }
  const bare = skeleton(word);
  // Short entries only match exactly, so "contact" or "console" stay allowed.
  if (
    BLOCKED.some(
      (blocked) =>
        bare === blocked || (blocked.length >= 5 && bare.includes(blocked)),
    )
  ) {
    throw new InvalidWordError('blocked');
  }
  return word;
}
