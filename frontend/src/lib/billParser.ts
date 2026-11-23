/**
 * Heuristic receipt/bill text parser (pure, no I/O). OCR output is noisy, so every
 * field is a *suggestion* the user must review before anything is saved.
 */
export interface ParsedBill {
  merchant?: string;
  /** yyyy-mm-dd */
  date?: string;
  /** decimal string, e.g. "1250.50" */
  total?: string;
  currency?: string;
  items: { name: string; amount: string }[];
  categoryHint?: string;
  /** 0..1 rough confidence that total was found on a "total"-like line */
  totalConfidence: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const TOTAL_STRONG = /(grand\s*total|net\s*total|total\s*(amount|due|payable)|amount\s*(due|payable)|balance\s*due|bill\s*total|net\s*amount|to\s*pay)/i;
const TOTAL_WEAK = /\btotal\b/i;
const SKIP_TOTAL = /(sub\s*-?\s*total|total\s*(items|qty|quantity|savings|discount|tax|vat)|tax|vat|change|cash|tendered|rounding|discount|points)/i;

const AMOUNT_RE = /(?:rs\.?|lkr|රු\.?)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/gi;

/** "1,250.50" | "1 250.50" | "1250" -> "1250.50"; rejects absurd values. */
export function normalizeAmount(raw: string): string | undefined {
  let s = raw.replace(/^[^\d]+/, '').replace(/[^\d.,]/g, '');
  if (!s) return undefined;
  // European style "1.250,50" or "1250,50"
  if (/,\d{2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e12) return undefined;
  return n.toFixed(2);
}

function amountsIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const v = normalizeAmount(m[1]!);
    if (v) out.push(v);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Day-first (Sri Lanka) unless the first number is > 12 or ISO. */
export function parseDate(text: string): string | undefined {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) { const r = validDate(+m[1]!, +m[2]!, +m[3]!); if (r) return r; }
  m = text.match(/\b(\d{1,2})[-/. ](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-/. ,]*(\d{2,4})\b/i);
  if (m) { const r = validDate(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!); if (r) return r; }
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
  if (m) { const r = validDate(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!); if (r) return r; }
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    const a = +m[1]!, b = +m[2]!;
    return validDate(+m[3]!, b, a) ?? validDate(+m[3]!, a, b);
  }
  return undefined;
}

const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['Groceries', /(supermarket|keells|cargills|arpico|laugfs|food\s*city|grocer|mart\b|vegetable|fruit)/i],
  ['Dining', /(restaurant|cafe|café|coffee|pizza|burger|kfc|mcdonald|bakery|hotel|dine|kitchen|bistro)/i],
  ['Transport', /(fuel|petrol|diesel|ceypetco|ioc|lanka\s*ioc|uber|pickme|taxi|parking|toll|bus|train)/i],
  ['Utilities', /(electric|ceb|leco|water\s*board|nwsdb|dialog|mobitel|slt|airtel|hutch|internet|broadband|telecom)/i],
  ['Health', /(pharmacy|pharma|hospital|clinic|medical|channel|lab\b|drug|osu\s*sala)/i],
  ['Shopping', /(odel|fashion|textile|noel|mall|store|boutique|cloth)/i],
  ['Education', /(school|tuition|university|institute|academy|books?)/i],
];

export function suggestCategory(text: string): string | undefined {
  return CATEGORY_KEYWORDS.find(([, re]) => re.test(text))?.[0];
}

export function parseReceiptText(raw: string): ParsedBill {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const text = lines.join('\n');
  const result: ParsedBill = { items: [], totalConfidence: 0 };

  // Currency
  if (/\b(lkr|rs\.?|රු)\b/i.test(text) || /\brs\b/i.test(text)) result.currency = 'LKR';
  else if (/\busd\b|\$/i.test(text)) result.currency = 'USD';

  // Merchant: first line with ≥3 letters that is not a date/phone/number-only line
  const merchant = lines.slice(0, 6).find((l) => (l.match(/[A-Za-z]/g)?.length ?? 0) >= 3 && !/^(tel|phone|hotline|invoice|receipt|bill|date|www|http)/i.test(l) && !/^[\d\s\-+()/.:]+$/.test(l));
  if (merchant) result.merchant = merchant.replace(/[^\w&'.,\- ]/g, '').trim().slice(0, 60) || undefined;

  result.date = parseDate(text);

  // Total
  let best: { v: string; score: number } | undefined;
  lines.forEach((line, idx) => {
    const strong = TOTAL_STRONG.test(line);
    const weak = TOTAL_WEAK.test(line);
    if (!strong && !weak) return;
    if (!strong && SKIP_TOTAL.test(line)) return;
    // amount on the same line, else on the next line (common in OCR column splits)
    const found = amountsIn(line);
    const cand = found.length ? found : amountsIn(lines[idx + 1] ?? '').slice(0, 1);
    if (!cand.length) return;
    const v = cand[cand.length - 1]!;
    const score = (strong ? 2 : 1) + idx / (lines.length * 10); // later lines win ties
    if (!best || score > best.score) best = { v, score };
  });
  if (best) { result.total = best.v; result.totalConfidence = best.score >= 2 ? 0.85 : 0.6; }
  else {
    const all = lines.flatMap((l) => (/(phone|tel|hotline|\d{9,})/i.test(l) ? [] : amountsIn(l)));
    if (all.length) { result.total = all.reduce((a, b) => (Number(b) > Number(a) ? b : a)); result.totalConfidence = 0.2; }
  }

  // Line items: "name ... amount" where name has letters and isn't a total/tax line
  for (const line of lines) {
    if (TOTAL_STRONG.test(line) || TOTAL_WEAK.test(line) || SKIP_TOTAL.test(line)) continue;
    const m = line.match(/^(.*?[A-Za-z].*?)\s+(?:rs\.?\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})$/i);
    if (m && m[1]!.length >= 2 && m[1]!.length <= 50) {
      const amount = normalizeAmount(m[2]!);
      if (amount) result.items.push({ name: m[1]!.trim(), amount });
    }
    if (result.items.length >= 30) break;
  }

  result.categoryHint = suggestCategory(text);
  return result;
}
