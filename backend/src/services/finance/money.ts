/**
 * Money primitives. All amounts are BigInt integers in the currency's minor unit.
 * No floating-point arithmetic is used anywhere in this module.
 *
 * LKR convention: 2 decimal places (1 LKR = 100 cents), minor units stored as integers.
 * Rounding convention for derived amounts (FX, interest): half away from zero.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** ISO-4217 exponents for currencies we explicitly support. Add more deliberately. */
const EXPONENTS: Readonly<Record<string, number>> = {
  LKR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  AUD: 2,
  SGD: 2,
  JPY: 0,
  KWD: 3,
};

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXPONENTS, code);
}

export function exponentOf(currency: string): number {
  const exp = EXPONENTS[currency];
  if (exp === undefined) throw new MoneyError(`Unsupported currency: ${currency}`);
  return exp;
}

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Parse a decimal string like "1234.50" into minor units. Rejects numbers, excess precision, junk. */
export function parseMajor(value: string, currency: string): bigint {
  if (typeof value !== 'string') throw new MoneyError('Amount must be a decimal string');
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new MoneyError(`Invalid amount: ${value}`);
  const exp = exponentOf(currency);
  const frac = m[3] ?? '';
  if (frac.length > exp) throw new MoneyError(`${currency} allows at most ${exp} decimal places`);
  const minor = BigInt(m[2]! + frac.padEnd(exp, '0'));
  return m[1] ? -minor : minor;
}

/** Format minor units as a plain decimal string ("1234.50"). No locale grouping; UI formats for display. */
export function formatMajor(minor: bigint, currency: string): string {
  const exp = exponentOf(currency);
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  if (exp === 0) return `${neg ? '-' : ''}${abs}`;
  const s = abs.toString().padStart(exp + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

/** Integer division rounding half away from zero. den must be > 0. */
export function divRound(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new MoneyError('Denominator must be positive');
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Parse a positive decimal rate string ("3.25", "0.0031") into [numerator, denominator]. */
export function parseRate(rate: string): [bigint, bigint] {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new MoneyError(`Invalid rate: ${rate}`);
  const frac = m[2] ?? '';
  if (frac.length > 12) throw new MoneyError('Rate allows at most 12 decimal places');
  const num = BigInt(m[1]! + frac);
  if (num === 0n) throw new MoneyError('Rate must be greater than zero');
  return [num, pow10(frac.length)];
}

/**
 * Convert minor units between currencies using an explicit decimal rate expressed as
 * (1 unit of `from` major) = rate (units of `to` major). Exponent differences handled exactly.
 */
export function convertMinor(minor: bigint, from: string, to: string, rate: string): bigint {
  const [rn, rd] = parseRate(rate);
  const num = minor * rn * pow10(exponentOf(to));
  const den = rd * pow10(exponentOf(from));
  return divRound(num, den);
}

/** minor * bps / 10000, rounded. */
export function applyBps(minor: bigint, bps: bigint): bigint {
  return divRound(minor * bps, 10000n);
}

export function assertPositiveMinor(minor: bigint, label = 'Amount'): void {
  if (typeof minor !== 'bigint') throw new MoneyError(`${label} must be an integer in minor units`);
  if (minor <= 0n) throw new MoneyError(`${label} must be greater than zero`);
}
