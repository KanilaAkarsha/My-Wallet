import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

/**
 * The API returns money as a decimal string, or (for multi-currency totals) as `[{ currency, amount }]`.
 * Normalises both to one string for the given currency; anything else becomes null (rendered as "—") instead of crashing.
 */
export function moneyString(v: unknown, currency = 'LKR'): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    const hit = v.find((x) => x && x.currency === currency) ?? (v.length === 0 ? { amount: '0.00' } : v[0]);
    return typeof hit?.amount === 'string' ? hit.amount : null;
  }
  if (v && typeof v === 'object' && typeof (v as { amount?: unknown }).amount === 'string') return (v as { amount: string }).amount;
  return null;
}

/** Formats a decimal string from the API for display. Never converts to float for arithmetic; only for presentation grouping. */
export function fmtMoney(raw: unknown, currency = 'LKR', opts: { hidden?: boolean; sign?: boolean } = {}): string {
  if (opts.hidden) return '••••••';
  const v = moneyString(raw, currency);
  if (v == null) return '—';
  const neg = v.startsWith('-');
  const [intPart, frac = ''] = v.replace('-', '').split('.');
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const digits = currency === 'JPY' ? 0 : 2;
  const f = digits ? `.${frac.padEnd(digits, '0').slice(0, digits)}` : '';
  const sym = currency === 'LKR' ? 'Rs ' : `${currency} `;
  return `${neg ? '-' : opts.sign ? '+' : ''}${sym}${grouped}${f}`;
}

export const fmtDate = (d: string | Date | null | undefined, tz = 'Asia/Colombo') =>
  d ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz }).format(new Date(d)) : '—';

export const toInputDate = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(d);

/** Presentation-only numeric view for charts; all ledger maths happens on the server in integer minor units. */
export const chartNum = (v: unknown) => Number(moneyString(v) ?? 0) || 0;

export const isNeg = (v?: unknown) => moneyString(v)?.startsWith('-') ?? false;
