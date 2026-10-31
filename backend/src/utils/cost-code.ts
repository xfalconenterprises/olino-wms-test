import { createHash } from 'crypto';

// Secret cost code: a 10-letter code word with no repeated letter stands for the digits
// 1,2,3,4,5,6,7,8,9,0. A cost of ₹245 with the word MAKEPROFIT is "AEP". Costs are coded in
// whole rupees.
//
// On a label the code always has 2 decoy letters before it and 1 after (e.g. "QXAEPZ").
// Decoys are letters that are NOT in the code word, so reading a code is simply: ignore every
// letter that isn't in the word. They are chosen from the roll's barcode together with the code
// word, so a reprint of the same roll shows the same code while other rolls of the same cost look
// different, and nobody can work the decoys out without the word.

export interface CostCodeConfig {
  codeWord: string;
}

const DIGITS = '1234567890';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The settings as they should be stored, or a message for the user. */
export function normaliseCostCodeConfig(input: { codeWord?: unknown }): CostCodeConfig | string {
  const codeWord = String(input.codeWord ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{10}$/.test(codeWord)) return 'The code word must be exactly 10 letters (A–Z).';
  if (new Set(codeWord).size !== 10) return 'Each letter can appear only once in the code word.';
  return { codeWord };
}

/** The code letters for a cost, without decoys: 245 → "AEP" (whole rupees). */
export function costLetters(price: number, config: CostCodeConfig): string {
  const rupees = Math.round(Number(price));
  if (!Number.isFinite(rupees) || rupees < 0) return '';
  return [...String(rupees)].map(d => config.codeWord[DIGITS.indexOf(d)]).join('');
}

/**
 * The code printed on a label: 2 decoy letters, the cost letters, 1 decoy letter, chosen for this
 * roll (`seed` = its barcode). Without a seed only the cost letters are returned.
 */
export function encodeCost(price: number, config: CostCodeConfig, seed?: string): string {
  const letters = costLetters(price, config);
  if (!letters || seed === undefined) return letters;
  const decoys = [...ALPHABET].filter(ch => !config.codeWord.includes(ch));
  const bytes = createHash('sha256').update(`${config.codeWord}|${seed}`).digest();
  const pick = (i: number) => decoys[bytes[i] % decoys.length];
  return `${pick(0)}${pick(1)}${letters}${pick(2)}`;
}

/** Reads a printed code back into rupees (decoy letters are skipped), or null when it isn't a valid code. */
export function decodeCost(code: string, config: CostCodeConfig): number | null {
  const letters = [...String(code ?? '').toUpperCase()].filter(ch => config.codeWord.includes(ch));
  if (letters.length === 0) return null;
  return Number(letters.map(ch => DIGITS[config.codeWord.indexOf(ch)]).join(''));
}
