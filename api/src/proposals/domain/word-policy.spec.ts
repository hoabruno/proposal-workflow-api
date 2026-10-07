import { InvalidWordError } from './errors.js';
import { validateWord } from './word-policy.js';

const reasonOf = (raw: string) => {
  try {
    validateWord(raw);
    return null;
  } catch (error) {
    return error instanceof InvalidWordError ? error.reason : 'unexpected';
  }
};

describe('validateWord', () => {
  it('normalizes case, spacing and unicode form', () => {
    expect(validateWord('  Vue.JS ')).toBe('vue.js');
    expect(validateWord('Carouge')).toBe('carouge');
    // Decomposed input (e + combining grave accent) must equal the precomposed form.
    expect(validateWord('Gene\u0300ve')).toBe('gen\u00e8ve');
  });

  it('accepts accents, digits, dots and hyphens', () => {
    for (const word of ['genève', 'nest-js', 'web3', 'œuvre', 'b2b']) {
      expect(reasonOf(word)).toBeNull();
    }
  });

  it('enforces the length that fits the tornado', () => {
    expect(reasonOf('a')).toBe('length');
    expect(reasonOf('abcdefghijklm')).toBe('length');
    expect(reasonOf('abcdefghijkl')).toBeNull();
  });

  it('rejects spaces, emoji and markup', () => {
    for (const word of ['deux mots', 'fire🔥', '<b>x</b>', 'drop;table']) {
      expect(reasonOf(word)).toBe('characters');
    }
  });

  it('blocks offensive words, including disguised ones', () => {
    expect(reasonOf('merde')).toBe('blocked');
    expect(reasonOf('m.e.r.d.e')).toBe('blocked');
    expect(reasonOf('connard')).toBe('blocked');
    expect(reasonOf('con')).toBe('blocked');
  });

  it('does not block innocent words that contain a short blocked entry', () => {
    expect(reasonOf('contact')).toBeNull();
    expect(reasonOf('console')).toBeNull();
  });
});
