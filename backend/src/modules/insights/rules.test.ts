import { describe, expect, it } from 'vitest';
import { billDueSoon, budgetExceeded, categorySpendChange, goalNearlyDone, pctChange, savingsRateChange, subscriptionSpendChange } from './rules.js';

const P = (a: string, b: string) => ({ from: new Date(a), to: new Date(b) });
const prevP = P('2026-10-01', '2026-10-12');
const curP = P('2026-11-01', '2026-11-12');

describe('pctChange', () => {
  it('rounds half away from zero and handles zero baseline', () => {
    expect(pctChange(10000n, 11500n)).toBe(15);
    expect(pctChange(10000n, 8000n)).toBe(-20);
    expect(pctChange(3n, 4n)).toBe(33);
    expect(pctChange(8n, 9n)).toBe(13); // 12.5 -> 13
    expect(pctChange(0n, 5n)).toBeNull();
  });
});

describe('insight rules use real numbers and explain themselves', () => {
  it('category change fires at >=15% and states calculation, period and why', () => {
    const i = categorySpendChange({ category: 'Food', categoryId: 'c1', currency: 'LKR', prev: 2000000n, cur: 2300000n, prevPeriod: prevP, curPeriod: curP, label: 'so far this month' })!;
    expect(i.headline).toBe('Your food spending increased by 15%');
    expect(i.what).toContain('LKR 23000.00');
    expect(i.calculation).toContain('= 15%');
    expect(i.why.length).toBeGreaterThan(10);
    expect(i.period).toEqual({ from: prevP.from, to: curP.to });
  });
  it('is silent below the threshold, for tiny baselines, and for zero baselines', () => {
    expect(categorySpendChange({ category: 'Food', categoryId: 'c', currency: 'LKR', prev: 2000000n, cur: 2100000n, prevPeriod: prevP, curPeriod: curP, label: 'x' })).toBeNull();
    expect(categorySpendChange({ category: 'Food', categoryId: 'c', currency: 'LKR', prev: 5000n, cur: 90000n, prevPeriod: prevP, curPeriod: curP, label: 'x' })).toBeNull();
    expect(categorySpendChange({ category: 'Food', categoryId: 'c', currency: 'LKR', prev: 0n, cur: 90000n, prevPeriod: prevP, curPeriod: curP, label: 'x' })).toBeNull();
  });
  it('decrease is positive', () => {
    const i = categorySpendChange({ category: 'Transport', categoryId: 't', currency: 'LKR', prev: 1000000n, cur: 700000n, prevPeriod: prevP, curPeriod: curP, label: 'x' })!;
    expect(i.severity).toBe('positive');
    expect(i.headline).toContain('decreased by 30%');
  });
  it('budget exceeded only when strictly over', () => {
    expect(budgetExceeded({ name: 'Transport', budgetId: 'b', currency: 'LKR', spent: 100n, budget: 100n, period: curP })).toBeNull();
    const i = budgetExceeded({ name: 'Transport', budgetId: 'b', currency: 'LKR', spent: 150000n, budget: 100000n, period: curP })!;
    expect(i.severity).toBe('critical');
    expect(i.calculation).toContain('500.00 over budget');
  });
  it('savings rate improvement needs >=5 points and positive incomes', () => {
    const i = savingsRateChange({ currency: 'LKR', prevIncome: 100000n, prevExpense: 90000n, curIncome: 100000n, curExpense: 80000n, prevPeriod: prevP, curPeriod: curP })!;
    expect(i.what).toBe('Your savings rate rose from 10% to 20%.');
    expect(savingsRateChange({ currency: 'LKR', prevIncome: 100000n, prevExpense: 90000n, curIncome: 100000n, curExpense: 87000n, prevPeriod: prevP, curPeriod: curP })).toBeNull();
    expect(savingsRateChange({ currency: 'LKR', prevIncome: 0n, prevExpense: 0n, curIncome: 100000n, curExpense: 1n, prevPeriod: prevP, curPeriod: curP })).toBeNull();
  });
  it('bill due soon: window of 0..3 days', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const mk = (d: string) => billDueSoon({ name: 'Electricity', billId: 'e', due: new Date(d), now, expected: 450000n, currency: 'LKR' });
    expect(mk('2026-11-13T00:00:00Z')!.headline).toBe('Electricity is due in 3 days');
    expect(mk('2026-11-14T00:00:00Z')).toBeNull();
    expect(mk('2026-11-09T00:00:00Z')).toBeNull();
    expect(mk('2026-11-10T00:00:00Z')!.headline).toContain('today');
  });
  it('subscription increase and goal near completion', () => {
    expect(subscriptionSpendChange({ currency: 'LKR', prev: 100000n, cur: 125000n, prevPeriod: prevP, curPeriod: curP })!.calculation).toContain('= 25%');
    expect(subscriptionSpendChange({ currency: 'LKR', prev: 100000n, cur: 105000n, prevPeriod: prevP, curPeriod: curP })).toBeNull();
    const now = new Date();
    expect(goalNearlyDone({ name: 'Laptop', goalId: 'g', current: 9100n, target: 10000n, currency: 'LKR', now })!.what).toContain('91%');
    expect(goalNearlyDone({ name: 'Laptop', goalId: 'g', current: 8000n, target: 10000n, currency: 'LKR', now })).toBeNull();
    expect(goalNearlyDone({ name: 'Laptop', goalId: 'g', current: 10000n, target: 10000n, currency: 'LKR', now })).toBeNull();
  });
});
