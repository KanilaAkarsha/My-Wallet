import { Link } from 'react-router-dom';
import { useState } from 'react';
import { CategoryPie, IncomeExpenseChart, TrendChart } from '@/components/charts';
import { useGet } from '@/components/ui/hooks';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Money, PageHeader, Progress, Select, Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/utils';
import { useUI } from '@/store/ui';
import { TxRow } from './Transactions';

const RANGES = [['this_month', 'This month'], ['previous_month', 'Last month'], ['last_7_days', 'Last 7 days'], ['this_week', 'This week'], ['last_3_months', 'Last 3 months'], ['today', 'Today']] as const;

export default function Dashboard() {
  const [range, setRange] = useState('this_month');
  const hidden = useUI((s) => s.hideBalances);
  const { data: d, isLoading, error, refetch } = useGet<any>(['dashboard'], '/dashboard', { range });
  const setQuickAdd = useUI((s) => s.setQuickAdd);
  if (error) return <ErrorBox error={error} retry={() => void refetch()} />;
  if (isLoading || !d) return <div className="space-y-4"><Skeleton className="h-28" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
  const c = d.currency as string;
  const k = d.kpis;
  const noData = d.balance.accounts.length === 0;
  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" action={<Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40" aria-label="Date range">{RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>} />
      {noData && <Card className="p-5"><Empty title="Let’s set up your first account" hint="Add an account (cash, bank, wallet) to start tracking." action={<Link to="/accounts"><Button>Add account</Button></Link>} /></Card>}
      <Card className="bg-brand p-5 text-brand-foreground">
        <p className="text-sm opacity-80">Total balance</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl"><Money value={d.balance.total} currency={c} /></p>
        <div className="mt-3 flex flex-wrap gap-2">{d.balance.accounts.filter((a: any) => !a.hidden).slice(0, 4).map((a: any) => <span key={a.id} className="rounded-full bg-white/15 px-3 py-1 text-xs">{a.name} · <Money value={a.balance} currency={a.currency} /></span>)}</div>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Income" v={k.totalIncome} c={c} tone="income" />
        <Kpi label="Expenses" v={k.totalExpenses} c={c} tone="expense" />
        <Kpi label="Net cash flow" v={k.netCashFlow} c={c} tone="auto" />
        <Kpi label="Savings rate" text={k.savingsRatePercent == null ? '—' : `${k.savingsRatePercent}%`} />
        <Kpi label="Savings" v={k.savings} c={c} />
        <Kpi label="Budget remaining" v={k.budgetRemaining} c={c} tone="auto" />
        <Kpi label="Outstanding debt" v={k.outstandingDebt} c={c} />
        <Kpi label="Subscriptions / mo" v={d.subscriptionSummary.monthly} c={c} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Income vs expenses" /><div className="p-4"><IncomeExpenseChart data={d.charts.incomeVsExpenses} currency={c} hidden={hidden} /></div></Card>
        <Card><CardHeader title="Spending by category" /><div className="p-4">{d.charts.spendingByCategory.length ? <CategoryPie data={d.charts.spendingByCategory} currency={c} hidden={hidden} /> : <Empty title="No spending in this period" />}</div></Card>
        <Card><CardHeader title="Daily spending" /><div className="p-4"><TrendChart data={d.charts.dailyTrend} x="date" y="expenses" currency={c} hidden={hidden} label="Daily spending trend" /></div></Card>
        <Card><CardHeader title="Balance history" /><div className="p-4"><TrendChart data={d.charts.balanceHistory} x="month" y="balance" currency={c} hidden={hidden} label="Balance history" /></div></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent transactions" action={<Link className="text-sm text-brand" to="/transactions">View all</Link>} />
          {d.recentTransactions.length ? <ul className="divide-y px-2 py-2">{d.recentTransactions.map((t: any) => <TxRow key={t.id} t={t} />)}</ul> : <Empty title="No transactions yet" action={<Button onClick={() => setQuickAdd(true)}>Add your first</Button>} />}
        </Card>
        <Card>
          <CardHeader title="Upcoming bills" action={<Link className="text-sm text-brand" to="/bills">All</Link>} />
          <ul className="space-y-2 p-4 text-sm">{d.upcomingBills.length ? d.upcomingBills.map((b: any) => <li key={b.id} className="flex justify-between"><span>{b.name}<span className="block text-xs text-muted-foreground">{fmtDate(b.dueDate)}</span></span><Money value={b.expectedAmount} currency={c} /></li>) : <li className="text-muted-foreground">Nothing due soon.</li>}</ul>
        </Card>
        <Card>
          <CardHeader title="Budgets" action={<Link className="text-sm text-brand" to="/budgets">All</Link>} />
          <div className="space-y-3 p-4">{d.budgetProgress.length ? d.budgetProgress.map((b: any) => <div key={b.id} className="space-y-1 text-sm"><div className="flex justify-between"><span>{b.name}</span><span className="num text-muted-foreground">{b.percentUsed}%</span></div><Progress value={b.percentUsed} tone={b.health === 'exceeded' ? 'bad' : b.health === 'warning' ? 'warn' : 'good'} /></div>) : <p className="text-sm text-muted-foreground">No active budgets.</p>}</div>
        </Card>
        <Card>
          <CardHeader title="Savings goals" action={<Link className="text-sm text-brand" to="/goals">All</Link>} />
          <div className="space-y-3 p-4">{d.goals.length ? d.goals.map((g: any) => <div key={g.id} className="space-y-1 text-sm"><div className="flex justify-between"><span>{g.name}</span><span className="num text-muted-foreground">{g.progressPercent}%</span></div><Progress value={g.progressPercent} /></div>) : <p className="text-sm text-muted-foreground">No goals yet.</p>}</div>
        </Card>
        <Card>
          <CardHeader title="Insights" action={<Link className="text-sm text-brand" to="/insights">All</Link>} />
          <ul className="space-y-2 p-4 text-sm">{d.insights.length ? d.insights.map((i: any) => <li key={i.id} className="flex gap-2"><Badge tone={i.severity === 'warning' ? 'warn' : i.severity === 'critical' ? 'bad' : 'neutral'}>{i.severity}</Badge>{i.headline}</li>) : <li className="text-muted-foreground">No insights yet.</li>}</ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, v, c = 'LKR', text, tone }: { label: string; v?: string | null; c?: string; text?: string; tone?: 'income' | 'expense' | 'auto' }) {
  return <Card className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{text ?? <Money value={v} currency={c} tone={tone} />}</p></Card>;
}
