// Secret cost code: a 10-letter code word with no repeated letter stands for the digits
// 1,2,3,4,5,6,7,8,9,0. A cost of ₹245 with the word MAKEPROFIT prints as "AEP".
// Optional extras make it harder to guess: a repeat letter written instead of a digit that
// repeats straight after itself (₹200 → "ATX" rather than "ATT"), and decoy letters before
// and after the code. Costs are coded in whole rupees.

export interface CostCodeConfig {
  codeWord: string;
  repeatLetter?: string | null;
  prefix?: string | null;
  suffix?: string | null;
}

const DIGITS = '1234567890';

/** The settings as they should be stored, or a message for the user. */
export function normaliseCostCodeConfig(input: Partial<Record<keyof CostCodeConfig, unknown>>): CostCodeConfig | string {
  const clean = (v: unknown) => String(v ?? '').trim().toUpperCase();
  const codeWord = clean(input.codeWord).replace(/\s+/g, '');
  const repeatLetter = clean(input.repeatLetter);
  const prefix = clean(input.prefix);
  const suffix = clean(input.suffix);

  if (!/^[A-Z]{10}$/.test(codeWord)) return 'The code word must be exactly 10 letters (A–Z).';
  if (new Set(codeWord).size !== 10) return 'Each letter can appear only once in the code word.';
  if (repeatLetter && !/^[A-Z]$/.test(repeatLetter)) return 'The repeat letter must be a single letter.';
  if (repeatLetter && codeWord.includes(repeatLetter)) return 'The repeat letter must not be one of the code word letters.';
  for (const [label, value] of [['Decoy letters before', prefix], ['Decoy letters after', suffix]] as const) {
    if (value && !/^[A-Z0-9]{1,3}$/.test(value)) return `${label} the code: up to 3 letters or digits.`;
  }
  return { codeWord, repeatLetter: repeatLetter || null, prefix: prefix || null, suffix: suffix || null };
}

/** The code printed for a cost, e.g. 245 → "AEP" (whole rupees). */
export function encodeCost(price: number, config: CostCodeConfig): string {
  const rupees = Math.round(Number(price));
  if (!Number.isFinite(rupees) || rupees < 0) return '';
  let body = '';
  let previous = '';
  for (const digit of String(rupees)) {
    // A digit repeated straight after itself is written as the repeat letter (only once in a row)
    const repeated = config.repeatLetter && digit === previous && body[body.length - 1] !== config.repeatLetter;
    body += repeated ? config.repeatLetter : config.codeWord[DIGITS.indexOf(digit)];
    previous = digit;
  }
  return `${config.prefix ?? ''}${body}${config.suffix ?? ''}`;
}

/** Reads a printed code back into rupees, or null when it isn't a valid code for these settings. */
export function decodeCost(code: string, config: CostCodeConfig): number | null {
  let text = String(code ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (config.prefix && text.startsWith(config.prefix)) text = text.slice(config.prefix.length);
  if (config.suffix && text.endsWith(config.suffix)) text = text.slice(0, -config.suffix.length);
  if (!text) return null;
  let digits = '';
  for (const ch of text) {
    if (config.repeatLetter && ch === config.repeatLetter) {
      if (!digits) return null;
      digits += digits[digits.length - 1];
      continue;
    }
    const i = config.codeWord.indexOf(ch);
    if (i < 0) return null;
    digits += DIGITS[i];
  }
  return Number(digits);
}
