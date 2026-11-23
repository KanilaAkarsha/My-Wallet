import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartNum, fmtMoney } from '@/lib/utils';

const PALETTE = ['#059669', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
const tip = { contentStyle: { borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 } };
const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11, tickLine: false, axisLine: false } as const;
const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function IncomeExpenseChart({ data, currency, hidden }: { data: { month: string; income: string | null; expenses: string | null }[]; currency: string; hidden?: boolean }) {
  const rows = data.map((d) => ({ month: d.month, Income: chartNum(d.income), Expenses: chartNum(d.expenses) }));
  return (
    <div role="img" aria-label="Income versus expenses by month" className="h-56">
      <ResponsiveContainer><BarChart data={rows} margin={{ left: -10 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.3} /><XAxis dataKey="month" {...axis} /><YAxis {...axis} tickFormatter={hidden ? () => '' : compact} />
        <Tooltip {...tip} formatter={(v: number) => fmtMoney(String(v), currency, { hidden })} />
        <Bar dataKey="Income" fill="#059669" radius={[4, 4, 0, 0]} /><Bar dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, x, y, currency, hidden, label }: { data: any[]; x: string; y: string; currency: string; hidden?: boolean; label: string }) {
  const rows = data.map((d) => ({ x: d[x], y: chartNum(d[y]) }));
  return (
    <div role="img" aria-label={label} className="h-56">
      <ResponsiveContainer><LineChart data={rows} margin={{ left: -10 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.3} /><XAxis dataKey="x" {...axis} minTickGap={24} /><YAxis {...axis} tickFormatter={hidden ? () => '' : compact} />
        <Tooltip {...tip} formatter={(v: number) => fmtMoney(String(v), currency, { hidden })} />
        <Line type="monotone" dataKey="y" stroke="#059669" strokeWidth={2} dot={false} />
      </LineChart></ResponsiveContainer>
    </div>
  );
}

export function CategoryPie({ data, currency, hidden }: { data: { name: string; amount: string | null; color?: string | null }[]; currency: string; hidden?: boolean }) {
  const rows = data.slice(0, 8).map((d, i) => ({ name: d.name, value: chartNum(d.amount), color: d.color ?? PALETTE[i % PALETTE.length] }));
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div role="img" aria-label="Spending by category" className="h-44 w-44 shrink-0">
        <ResponsiveContainer><PieChart><Pie data={rows} dataKey="value" innerRadius={44} outerRadius={78} paddingAngle={2}>{rows.map((r, i) => <Cell key={i} fill={r.color ?? PALETTE[0]} />)}</Pie>
          <Tooltip {...tip} formatter={(v: number) => fmtMoney(String(v), currency, { hidden })} /></PieChart></ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {rows.map((r) => <li key={r.name} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}</span><span className="num text-muted-foreground">{fmtMoney(String(r.value), currency, { hidden })}</span></li>)}
      </ul>
    </div>
  );
}
