import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Modal, Money, PageHeader, Progress, Select, Skeleton } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { fmtDate, toInputDate } from '@/lib/utils';

const amount = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Enter an amount, e.g. 2500');
const iso = (d: string) => new Date(`${d}T12:00:00+05:30`).toISOString();

/** Shows an upgrade nudge instead of a raw error when a plan limit/feature gate blocks the action. */
export function PlanGate({ error }: { error: unknown }) {
  if (!error) return null;
  const gated = error instanceof ApiError && (error.status === 402 || error.status === 403) && /plan|limit|upgrade|feature/i.test(error.message);
  return gated ? <div role="alert" className="rounded-md border border-warn/30 bg-warn/5 p-3 text-sm">{(error as Error).message} <Link className="text-brand underline" to="/settings/billing">See plans</Link></div> : <ErrorBox error={error} />;
}

function ListShell({ title, sub, add, loading, error, empty, children, action }: { title: string; sub?: string; add?: string; loading: boolean; error: unknown; empty: boolean; children: ReactNode; action?: () => void }) {
  return (
    <div>
      <PageHeader title={title} sub={sub} action={add ? <Button onClick={action}>{add}</Button> : undefined} />
      {error ? <PlanGate error={error} /> : loading ? <Skeleton className="h-40" /> : empty ? <Card><Empty title={`No ${title.toLowerCase()} yet`} action={add ? <Button onClick={action}>{add}</Button> : undefined} /></Card> : children}
    </div>
  );
}

/* ---------------- Budgets ---------------- */
const budgetSchema = z.object({ name: z.string().trim().min(1, 'Name required'), period: z.enum(['monthly', 'weekly']), amount, categoryId: z.string().optional(), warnAtPercent: z.coerce.number().int().min(1).max(100) });
export function BudgetsPage({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const { data, isLoading, error } = useGet<{ budgets: any[] }>(['budgets'], '/budgets');
  const cats = useGet<{ categories: any[] }>(['categories'], '/categories');
  const f = useForm<z.infer<typeof budgetSchema>>({ resolver: zodResolver(budgetSchema), defaultValues: { period: 'monthly', warnAtPercent: 80 } });
  const create = useSend('POST', '/budgets', { onSuccess: () => { setOpen(false); f.reset(); } });
  const submit = f.handleSubmit((v) => {
    const now = new Date();
    create.mutate({ name: v.name, period: v.period, amount: v.amount, warnAtPercent: v.warnAtPercent, categoryIds: v.categoryId ? [v.categoryId] : [], ...(v.period === 'monthly' ? { month: now.getMonth() + 1, year: now.getFullYear() } : {}) } as any);
  });
  const rows = (data?.budgets ?? []).filter((b) => b.status !== 'archived');
  return (
    <>
      <ListShell title="Budgets" sub="Spending against your plan. Refunds reduce spend." add="New budget" action={() => setOpen(true)} loading={isLoading} error={error} empty={!rows.length}>
        <div className="grid gap-3 sm:grid-cols-2">{rows.map((b) => (
          <Link key={b.id} to={`/budgets/${b.id}`}><Card className="space-y-3 p-4 hover:shadow-md">
            <div className="flex items-center justify-between"><span className="font-medium">{b.name}</span><Badge tone={b.health === 'exceeded' ? 'bad' : b.health === 'warning' ? 'warn' : 'good'}>{b.health === 'exceeded' ? 'Over budget' : b.health === 'warning' ? 'Nearing limit' : 'On track'}</Badge></div>
            <Progress value={b.percentUsed} tone={b.health === 'exceeded' ? 'bad' : b.health === 'warning' ? 'warn' : 'good'} />
            <div className="flex justify-between text-sm"><span><Money value={b.spent} currency={b.currency} /> of <Money value={b.amount} currency={b.currency} /></span><span className="text-muted-foreground"><Money value={b.remaining} currency={b.currency} /> left</span></div>
          </Card></Link>
        ))}</div>
      </ListShell>
      <Modal open={open} onOpenChange={setOpen} title="New budget">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} placeholder="e.g. Food & dining" /></Field>
          <Field label="Period"><Select {...f.register('period')}><option value="monthly">This month</option><option value="weekly">Weekly</option></Select></Field>
          <Field label="Limit" error={f.formState.errors.amount?.message}><Input inputMode="decimal" {...f.register('amount')} /></Field>
          <Field label="Category (leave empty for all spending)"><Select {...f.register('categoryId')}><option value="">All expenses</option>{(cats.data?.categories ?? []).filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Warn at (%)" error={f.formState.errors.warnAtPercent?.message}><Input type="number" {...f.register('warnAtPercent')} /></Field>
          {create.error && <PlanGate error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Create budget</Button>
        </form>
      </Modal>
    </>
  );
}

export function BudgetDetail() {
  const { id } = useParams();
  const { data: b, error } = useGet<any>(['budget'], `/budgets/${id}`);
  const archive = useSend('POST', `/budgets/${id}/archive`);
  if (error) return <ErrorBox error={error} />;
  if (!b) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <PageHeader title={b.name} sub={`${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`} action={<Button variant="outline" onClick={() => archive.mutate({})}>Archive</Button>} />
      <Card className="space-y-3 p-5"><Progress value={b.percentUsed} tone={b.health === 'exceeded' ? 'bad' : b.health === 'warning' ? 'warn' : 'good'} /><p className="text-sm"><Money value={b.spent} currency={b.currency} /> spent of <Money value={b.amount} currency={b.currency} /> · <Money value={b.remaining} currency={b.currency} tone="auto" /> remaining ({b.percentUsed}%)</p>
        <p className="text-xs text-muted-foreground">Categories: {b.categories.length ? b.categories.map((c: any) => c.name).join(', ') : 'all expenses'}</p></Card>
      {Array.isArray(b.history) && b.history.length > 0 && <Card><CardHeader title="Previous periods" /><ul className="divide-y p-2 text-sm">{b.history.map((h: any, i: number) => <li key={i} className="flex justify-between px-2 py-2"><span>{h.label ?? fmtDate(h.startDate)}</span><span><Money value={h.spent} currency={b.currency} /> / <Money value={h.budget ?? h.amount} currency={b.currency} /></span></li>)}</ul></Card>}
    </div>
  );
}

/* ---------------- Goals ---------------- */
const goalSchema = z.object({ name: z.string().trim().min(1, 'Name required'), targetAmount: amount, targetDate: z.string().optional(), linkedAccountId: z.string().optional() });
export function GoalsPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useGet<{ goals: any[] }>(['goals'], '/goals');
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const f = useForm<z.infer<typeof goalSchema>>({ resolver: zodResolver(goalSchema) });
  const create = useSend('POST', '/goals', { onSuccess: () => { setOpen(false); f.reset(); } });
  const rows = (data?.goals ?? []).filter((g) => g.status !== 'archived');
  return (
    <>
      <ListShell title="Savings goals" add="New goal" action={() => setOpen(true)} loading={isLoading} error={error} empty={!rows.length}>
        <div className="grid gap-3 sm:grid-cols-2">{rows.map((g) => (
          <Link key={g.id} to={`/goals/${g.id}`}><Card className="space-y-3 p-4 hover:shadow-md">
            <div className="flex items-center justify-between"><span className="font-medium">{g.name}</span><span className="num text-sm text-muted-foreground">{g.progressPercent}%</span></div>
            <Progress value={g.progressPercent} />
            <p className="text-sm"><Money value={g.current} currency={g.currency} /> of <Money value={g.target} currency={g.currency} /></p>
            {g.estimate?.estimatedDate && <p className="text-xs text-muted-foreground">At your recent pace: ~{fmtDate(g.estimate.estimatedDate)}</p>}
          </Card></Link>
        ))}</div>
      </ListShell>
      <Modal open={open} onOpenChange={setOpen} title="New savings goal">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ name: v.name, targetAmount: v.targetAmount, ...(v.targetDate ? { targetDate: iso(v.targetDate) } : {}), ...(v.linkedAccountId ? { linkedAccountId: v.linkedAccountId } : {}) } as any))} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} placeholder="e.g. Emergency fund" /></Field>
          <Field label="Target amount" error={f.formState.errors.targetAmount?.message}><Input inputMode="decimal" {...f.register('targetAmount')} /></Field>
          <Field label="Target date (optional)"><Input type="date" {...f.register('targetDate')} /></Field>
          <Field label="Linked savings account (optional)" hint="Contributions then move real money between accounts."><Select {...f.register('linkedAccountId')}><option value="">None (track only)</option>{(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          {create.error && <PlanGate error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Create goal</Button>
        </form>
      </Modal>
    </>
  );
}

export function GoalDetail() {
  const { id } = useParams();
  const { data: g, error } = useGet<any>(['goal'], `/goals/${id}`);
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const [dir, setDir] = useState<'contribution' | 'withdrawal'>('contribution');
  const [amt, setAmt] = useState('');
  const [acct, setAcct] = useState('');
  const flow = useSend('POST', `/goals/${id}/contributions`, { idempotent: true, onSuccess: () => setAmt('') });
  if (error) return <ErrorBox error={error} />;
  if (!g) return <Skeleton className="h-48" />;
  const valid = /^\d{1,15}(\.\d{1,2})?$/.test(amt) && Number(amt) > 0 && (!g.linkedAccountId || !!acct);
  return (
    <div className="space-y-4">
      <PageHeader title={g.name} sub={g.targetDate ? `Target ${fmtDate(g.targetDate)}` : undefined} />
      <Card className="space-y-3 p-5"><Progress value={g.progressPercent} /><p><Money value={g.current} currency={g.currency} className="text-2xl font-semibold" /> <span className="text-sm text-muted-foreground">of <Money value={g.target} currency={g.currency} /> · <Money value={g.remaining} currency={g.currency} /> to go</span></p>
        {g.estimate?.estimatedDate && <p className="text-sm text-muted-foreground">Estimated completion ~{fmtDate(g.estimate.estimatedDate)} ({g.estimate.basis}). An estimate, not a promise.</p>}</Card>
      <Card className="space-y-3 p-5">
        <div className="flex gap-2"><Select value={dir} onChange={(e) => setDir(e.target.value as any)} aria-label="Direction" className="w-40"><option value="contribution">Add money</option><option value="withdrawal">Withdraw</option></Select><Input inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" /></div>
        {g.linkedAccountId && <Select value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Source account"><option value="">{dir === 'contribution' ? 'From account…' : 'To account…'}</option>{(accounts.data?.accounts ?? []).filter((a) => a.id !== g.linkedAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
        {flow.error && <ErrorBox error={flow.error} />}
        <Button disabled={!valid} loading={flow.isPending} onClick={() => flow.mutate({ direction: dir, amount: amt, ...(acct ? { accountId: acct } : {}) } as any)}>{dir === 'contribution' ? 'Contribute' : 'Withdraw'}</Button>
      </Card>
      <Card><CardHeader title="History" />{g.contributions?.length ? <ul className="divide-y p-2 text-sm">{g.contributions.map((c: any) => <li key={c.id} className="flex justify-between px-2 py-2"><span>{fmtDate(c.date)} · {c.direction}</span><Money value={c.amount} currency={g.currency} tone={c.direction === 'contribution' ? 'income' : 'expense'} /></li>)}</ul> : <Empty title="No contributions yet" />}</Card>
    </div>
  );
}

/* ---------------- Debts ---------------- */
const KINDS = [['borrowed', 'Money I borrowed'], ['lent', 'Money I lent'], ['personal_loan', 'Personal loan'], ['credit_card', 'Credit card'], ['student_loan', 'Student loan'], ['installment', 'Installment plan']];
const debtSchema = z.object({ kind: z.string(), counterparty: z.string().trim().min(1, 'Required'), principal: amount, interestRatePercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'e.g. 12.5'), interestMethod: z.string(), accountId: z.string().optional() });
export function DebtsPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useGet<any>(['debts'], '/debts');
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const f = useForm<z.infer<typeof debtSchema>>({ resolver: zodResolver(debtSchema), defaultValues: { kind: 'borrowed', interestRatePercent: '0', interestMethod: 'none' } });
  const create = useSend('POST', '/debts', { idempotent: true, onSuccess: () => { setOpen(false); f.reset(); } });
  const rows: any[] = (data?.debts ?? []).filter((d: any) => d.status !== 'archived');
  return (
    <>
      <ListShell title="Debts & loans" add="Add debt" action={() => setOpen(true)} loading={isLoading} error={error} empty={!rows.length}>
        <div className="mb-4 grid grid-cols-2 gap-3"><Card className="p-4"><p className="text-xs text-muted-foreground">I owe</p><Money value={data?.outstandingLiabilities} className="text-xl font-semibold" tone="expense" /></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Owed to me</p><Money value={data?.outstandingReceivables} className="text-xl font-semibold" tone="income" /></Card></div>
        <div className="grid gap-3 sm:grid-cols-2">{rows.map((d) => (
          <Link key={d.id} to={`/debts/${d.id}`}><Card className="space-y-2 p-4 hover:shadow-md"><div className="flex justify-between"><span className="font-medium">{d.counterparty}</span><Badge tone={d.direction === 'receivable' ? 'good' : 'neutral'}>{d.kind.replace('_', ' ')}</Badge></div><Progress value={d.repaidPercent} /><p className="text-sm"><Money value={d.totalOwed} currency={d.currency} /> outstanding · {d.repaidPercent}% repaid</p></Card></Link>
        ))}</div>
      </ListShell>
      <Modal open={open} onOpenChange={setOpen} title="Add debt or loan">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ kind: v.kind, counterparty: v.counterparty, principal: v.principal, interestRatePercent: v.interestRatePercent, interestMethod: Number(v.interestRatePercent) > 0 && v.interestMethod === 'none' ? 'simple' : v.interestMethod, ...(v.accountId ? { accountId: v.accountId } : {}) } as any))} className="space-y-4" noValidate>
          <Field label="Type"><Select {...f.register('kind')}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Person / lender" error={f.formState.errors.counterparty?.message}><Input {...f.register('counterparty')} /></Field>
          <Field label="Amount" error={f.formState.errors.principal?.message}><Input inputMode="decimal" {...f.register('principal')} /></Field>
          <Field label="Interest (% per year)" error={f.formState.errors.interestRatePercent?.message}><Input inputMode="decimal" {...f.register('interestRatePercent')} /></Field>
          <Field label="Interest method"><Select {...f.register('interestMethod')}><option value="none">None</option><option value="simple">Simple</option><option value="reducing_balance">Reducing balance</option></Select></Field>
          <Field label="Account (optional)" hint="Where borrowed money arrived, or lent money came from. Leave empty to only track it."><Select {...f.register('accountId')}><option value="">Track only</option>{(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          {create.error && <ErrorBox error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Save</Button>
        </form>
      </Modal>
    </>
  );
}

export function DebtDetail() {
  const { id } = useParams();
  const { data: d, error } = useGet<any>(['debt'], `/debts/${id}`);
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const [amt, setAmt] = useState('');
  const [acct, setAcct] = useState('');
  const pay = useSend('POST', `/debts/${id}/payments`, { idempotent: true, onSuccess: () => setAmt('') });
  const accrue = useSend('POST', `/debts/${id}/accrue`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <PageHeader title={d.counterparty} sub={`${d.kind.replace('_', ' ')} · ${d.interestRatePercent}% ${d.interestMethod}`} action={d.interestMethod !== 'none' ? <Button variant="outline" onClick={() => accrue.mutate({})} loading={accrue.isPending}>Accrue interest</Button> : undefined} />
      <Card className="grid grid-cols-3 gap-3 p-5 text-sm"><div><p className="text-muted-foreground">Principal</p><Money value={d.outstandingPrincipal} currency={d.currency} className="font-semibold" /></div><div><p className="text-muted-foreground">Interest</p><Money value={d.accruedInterest} currency={d.currency} className="font-semibold" /></div><div><p className="text-muted-foreground">Total</p><Money value={d.totalOwed} currency={d.currency} className="font-semibold" /></div><div className="col-span-3"><Progress value={d.repaidPercent} /></div></Card>
      {d.status === 'active' && <Card className="space-y-3 p-5"><h2 className="text-sm font-semibold">Record a payment</h2><p className="text-xs text-muted-foreground">Interest is paid first; the rest reduces principal.</p>
        <div className="flex gap-2"><Input inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Payment amount" /><Select value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Account"><option value="">Account…</option>{(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
        {pay.error && <ErrorBox error={pay.error} />}<Button disabled={!amt || !acct} loading={pay.isPending} onClick={() => pay.mutate({ amount: amt, accountId: acct, date: iso(toInputDate()) } as any)}>Record payment</Button></Card>}
      <Card><CardHeader title="Payments" />{d.payments?.length ? <ul className="divide-y p-2 text-sm">{d.payments.map((p: any) => <li key={p.id} className="flex justify-between px-2 py-2"><span>{fmtDate(p.date)}</span><span><Money value={p.total} currency={d.currency} /> <span className="text-xs text-muted-foreground">(interest <Money value={p.interest} currency={d.currency} />)</span></span></li>)}</ul> : <Empty title="No payments yet" />}</Card>
    </div>
  );
}
