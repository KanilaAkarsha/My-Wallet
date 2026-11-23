import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Money, PageHeader, Progress, Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/utils';

const tone = (s: string) => (s === 'exceeded' ? 'bad' : s === 'warning' ? 'warn' : 'good');
const num = (v: string | null | undefined) => (v ? v.replace(/\.00$/, '') : '');
const dateIn = (d: string | null) => (d ? d.slice(0, 10) : '');

function Pace({ title, p, c }: { title: string; p: any; c: string }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between"><h2 className="font-medium">{title}</h2><Badge tone={tone(p.status) as any}>{p.status.replace('_', ' ')}</Badge></div>
      <Progress value={p.percentUsed} tone={tone(p.status) as any} />
      <p className="text-sm"><Money value={p.spent} currency={c} /> of <Money value={p.limit} currency={c} /> · <Money value={p.remaining} currency={c} tone="auto" /> left</p>
      <p className="text-xs text-muted-foreground">Safe to spend about <Money value={p.safeDailySpend} currency={c} /> per day for the remaining {p.daysLeft} day{p.daysLeft === 1 ? '' : 's'}.</p>
    </Card>
  );
}

export default function PlannerPage() {
  const { data: d, isLoading, error } = useGet<any>(['planner'], '/planner');
  const f = useForm<Record<string, string>>();
  const save = useSend('PUT', '/planner');
  useEffect(() => { if (d) { const s = d.settings; f.reset({ monthlyAllowance: num(s.monthlyAllowance), weeklyLimit: num(s.weeklyLimit), semesterBudget: num(s.semesterBudget), semesterStart: dateIn(s.semesterStart), semesterEnd: dateIn(s.semesterEnd), monthlySalary: num(s.monthlySalary), emergencyTargetMonths: String(s.emergencyTargetMonths) }); } }, [d, f]);
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !d) return <Skeleton className="h-64" />;
  const c = d.currency as string;
  const dec = (v: string) => (v?.trim() ? v.trim() : null);
  const submit = f.handleSubmit((v) => save.mutate({
    monthlyAllowance: dec(v.monthlyAllowance), weeklyLimit: dec(v.weeklyLimit), semesterBudget: dec(v.semesterBudget), monthlySalary: dec(v.monthlySalary),
    semesterStart: v.semesterStart ? new Date(`${v.semesterStart}T00:00:00+05:30`).toISOString() : null, semesterEnd: v.semesterEnd ? new Date(`${v.semesterEnd}T00:00:00+05:30`).toISOString() : null,
    emergencyTargetMonths: Number(v.emergencyTargetMonths) || 6,
  } as any));
  const ef = d.emergencyFund;
  return (
    <div className="space-y-4">
      <PageHeader title="Planner" sub="Allowance, semester and salary planning from your own transactions. Guidelines, not financial advice." />
      {!d.modes.student && !d.modes.youngProfessional && <p className="rounded-md bg-muted p-3 text-sm">Turn on Student or Young professional mode in <Link className="text-brand underline" to="/settings/profile">Settings</Link> — everything below works either way.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {d.weekly && <Pace title="Weekly spending limit" p={d.weekly} c={c} />}
        {d.allowance && <Pace title="Monthly allowance" p={d.allowance} c={c} />}
        {d.semester && <Pace title={`Semester budget (${fmtDate(d.semester.start)} – ${fmtDate(d.semester.end)})`} p={d.semester} c={c} />}
        {d.salaryPlan && <Card className="space-y-2 p-4"><h2 className="font-medium">Salary plan</h2><ul className="space-y-1 text-sm"><li className="flex justify-between"><span>Needs (50%)</span><Money value={d.salaryPlan.needs} currency={c} /></li><li className="flex justify-between"><span>Wants (30%)</span><Money value={d.salaryPlan.wants} currency={c} /></li><li className="flex justify-between"><span>Savings (20%)</span><Money value={d.salaryPlan.savings} currency={c} /></li></ul><p className="text-xs text-muted-foreground">{d.salaryPlan.note}</p></Card>}
        <Card className="space-y-2 p-4"><h2 className="font-medium">Emergency fund</h2>
          {ef.monthsCovered == null ? <p className="text-sm text-muted-foreground">Add some spending history to estimate coverage.</p> : <><Progress value={Math.min(100, (ef.monthsCovered / ef.targetMonths) * 100)} /><p className="text-sm">{ef.monthsCovered} of {ef.targetMonths} months covered · <Money value={ef.fund} currency={c} /> saved, <Money value={ef.shortfall} currency={c} /> to target</p></>}
          <p className="text-xs text-muted-foreground">{ef.basis}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Savings rate this month</p><p className="text-2xl font-semibold">{d.savingsRatePercent == null ? '—' : `${d.savingsRatePercent}%`}</p></Card>
      </div>
      <Card><CardHeader title="Your planning inputs (all optional)" />
        <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2" noValidate>
          <Field label="Monthly allowance"><Input inputMode="decimal" {...f.register('monthlyAllowance')} /></Field>
          <Field label="Weekly spending limit"><Input inputMode="decimal" {...f.register('weeklyLimit')} /></Field>
          <Field label="Semester budget"><Input inputMode="decimal" {...f.register('semesterBudget')} /></Field>
          <Field label="Monthly take-home salary"><Input inputMode="decimal" {...f.register('monthlySalary')} /></Field>
          <Field label="Semester start"><Input type="date" {...f.register('semesterStart')} /></Field>
          <Field label="Semester end"><Input type="date" {...f.register('semesterEnd')} /></Field>
          <Field label="Emergency fund target (months)"><Input type="number" min={1} max={24} {...f.register('emergencyTargetMonths')} /></Field>
          <div className="flex items-end">{save.error ? <ErrorBox error={save.error} /> : null}<Button type="submit" loading={save.isPending} className="ml-auto">Save</Button></div>
        </form></Card>
    </div>
  );
}
