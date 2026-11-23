import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, Empty, Field, Input, Modal, Money, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { fmtDate, toInputDate } from '@/lib/utils';
import { PlanGate } from './Planning';

const amount = z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Enter an amount');
const iso = (d: string) => new Date(`${d}T12:00:00+05:30`).toISOString();
const FREQ = ['weekly', 'monthly', 'quarterly', 'yearly'];

function useAccounts() { return (useGet<{ accounts: any[] }>(['accounts'], '/accounts').data?.accounts ?? []).filter((a) => a.status === 'active'); }

/* ---------- Bills ---------- */
const billSchema = z.object({ name: z.string().trim().min(1, 'Required'), expectedAmount: amount, frequency: z.string(), firstDueDate: z.string().min(1) });
export function BillsPage() {
  const [open, setOpen] = useState(false);
  const [payFor, setPayFor] = useState<any>(null);
  const [acct, setAcct] = useState('');
  const accounts = useAccounts();
  const { data, isLoading, error } = useGet<{ bills: any[] }>(['bills'], '/bills');
  const f = useForm<z.infer<typeof billSchema>>({ resolver: zodResolver(billSchema), defaultValues: { frequency: 'monthly', firstDueDate: toInputDate() } });
  const create = useSend('POST', '/bills', { onSuccess: () => { setOpen(false); f.reset(); } });
  const pay = useSend('POST', payFor ? `/bills/${payFor.id}/pay` : '/bills', { idempotent: true, onSuccess: () => setPayFor(null) });
  const tone = (s: string) => (s === 'overdue' ? 'bad' : s === 'due_soon' ? 'warn' : 'neutral');
  return (
    <div>
      <PageHeader title="Bills" action={<Button onClick={() => setOpen(true)}>Add bill</Button>} />
      {error ? <PlanGate error={error} /> : isLoading ? <Skeleton className="h-32" /> : !data?.bills.length ? <Card><Empty title="No bills yet" hint="Track rent, utilities and other due dates." /></Card> : (
        <Card><ul className="divide-y">{data.bills.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1"><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">Due {fmtDate(b.nextDueDate)} · {b.recurrence.frequency}</p></div>
            <Badge tone={tone(b.paymentStatus) as any}>{b.paymentStatus.replace('_', ' ')}</Badge>
            <Money value={b.expectedAmount} currency={b.currency} className="font-medium" />
            <Button size="sm" variant="outline" onClick={() => { setPayFor(b); setAcct(b.accountId ?? ''); }}>Mark paid</Button>
          </li>))}</ul></Card>)}
      <Modal open={open} onOpenChange={setOpen} title="Add bill">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ name: v.name, expectedAmount: v.expectedAmount, firstDueDate: iso(v.firstDueDate), recurrence: { frequency: v.frequency } } as any))} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} /></Field>
          <Field label="Expected amount" error={f.formState.errors.expectedAmount?.message}><Input inputMode="decimal" {...f.register('expectedAmount')} /></Field>
          <Field label="Repeats"><Select {...f.register('frequency')}>{[...FREQ, 'daily'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="First due date"><Input type="date" {...f.register('firstDueDate')} /></Field>
          {create.error && <PlanGate error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Save bill</Button>
        </form>
      </Modal>
      <Modal open={!!payFor} onOpenChange={(o) => !o && setPayFor(null)} title={`Pay ${payFor?.name ?? ''}`}>
        <div className="space-y-4"><Field label="Pay from"><Select value={acct} onChange={(e) => setAcct(e.target.value)}><option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          {pay.error && <PlanGate error={pay.error} />}<Button className="w-full" disabled={!acct} loading={pay.isPending} onClick={() => pay.mutate({ accountId: acct } as any)}>Record payment</Button></div>
      </Modal>
    </div>
  );
}

/* ---------- Recurring ---------- */
const recSchema = z.object({ title: z.string().trim().min(1, 'Required'), type: z.enum(['income', 'expense']), amount, accountId: z.string().min(1, 'Choose account'), frequency: z.string(), startDate: z.string().min(1), autoPost: z.boolean().optional() });
export function RecurringPage() {
  const [open, setOpen] = useState(false);
  const accounts = useAccounts();
  const { data, isLoading, error } = useGet<{ recurring: any[] }>(['recurring'], '/recurring');
  const f = useForm<z.infer<typeof recSchema>>({ resolver: zodResolver(recSchema), defaultValues: { type: 'expense', frequency: 'monthly', startDate: toInputDate() } });
  const create = useSend('POST', '/recurring', { onSuccess: () => { setOpen(false); f.reset(); } });
  const run = useSend('POST', '/recurring/run');
  const toggle = useSend<any, any>('PATCH', (b) => `/recurring/${b.id}`);
  const remove = useSend<any, string>('DELETE', (id) => `/recurring/${id}`);
  return (
    <div>
      <PageHeader title="Recurring" sub="Salary, rent and other repeating transactions." action={<div className="flex gap-2"><Button variant="outline" onClick={() => run.mutate({})} loading={run.isPending}>Generate due now</Button><Button onClick={() => setOpen(true)}>Add</Button></div>} />
      {error ? <PlanGate error={error} /> : isLoading ? <Skeleton className="h-32" /> : !data?.recurring.length ? <Card><Empty title="Nothing recurring yet" /></Card> : (
        <Card><ul className="divide-y">{data.recurring.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1"><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.frequency} · next {fmtDate(r.nextRun)} · {r.autoPost ? 'auto-posts' : 'creates drafts'}</p></div>
            <Badge tone={r.status === 'active' ? 'good' : 'neutral'}>{r.status}</Badge>
            <Money value={r.amount} currency={r.currency} tone={r.type === 'income' ? 'income' : 'expense'} />
            <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: r.id, status: r.status === 'active' ? 'paused' : 'active' })}>{r.status === 'active' ? 'Pause' : 'Resume'}</Button>
            <Button size="sm" variant="ghost" onClick={() => window.confirm('Delete this schedule? Past transactions are kept.') && remove.mutate(r.id)}>Delete</Button>
          </li>))}</ul></Card>)}
      <Modal open={open} onOpenChange={setOpen} title="Add recurring transaction">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ title: v.title, type: v.type, amount: v.amount, accountId: v.accountId, frequency: v.frequency, startDate: iso(v.startDate), autoPost: !!v.autoPost } as any))} className="space-y-4" noValidate>
          <Field label="Title" error={f.formState.errors.title?.message}><Input {...f.register('title')} /></Field>
          <Field label="Type"><Select {...f.register('type')}><option value="expense">Expense</option><option value="income">Income</option></Select></Field>
          <Field label="Amount" error={f.formState.errors.amount?.message}><Input inputMode="decimal" {...f.register('amount')} /></Field>
          <Field label="Account" error={f.formState.errors.accountId?.message}><Select {...f.register('accountId')}><option value="">Select…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Repeats"><Select {...f.register('frequency')}>{['daily', ...FREQ].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Starts"><Input type="date" {...f.register('startDate')} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('autoPost')} /> Post automatically (otherwise creates a draft to confirm)</label>
          {create.error && <PlanGate error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Save</Button>
        </form>
      </Modal>
    </div>
  );
}

/* ---------- Subscriptions ---------- */
const subSchema = z.object({ name: z.string().trim().min(1, 'Required'), amount, billingFrequency: z.string(), nextBillingDate: z.string().min(1) });
export function SubscriptionsPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useGet<any>(['subscriptions'], '/subscriptions');
  const f = useForm<z.infer<typeof subSchema>>({ resolver: zodResolver(subSchema), defaultValues: { billingFrequency: 'monthly', nextBillingDate: toInputDate() } });
  const create = useSend('POST', '/subscriptions', { onSuccess: () => { setOpen(false); f.reset(); } });
  const act = useSend<any, { id: string; op: string }>('POST', (b) => `/subscriptions/${b.id}/${b.op}`);
  const subs: any[] = data?.subscriptions ?? [];
  return (
    <div>
      <PageHeader title="Subscriptions" sub="Cancelling here records your decision; cancel with the provider yourself." action={<Button onClick={() => setOpen(true)}>Add subscription</Button>} />
      {error ? <PlanGate error={error} /> : isLoading ? <Skeleton className="h-32" /> : !subs.length ? <Card><Empty title="No subscriptions tracked" /></Card> : (<>
        <div className="mb-3 grid grid-cols-2 gap-3"><Card className="p-4"><p className="text-xs text-muted-foreground">Monthly</p><Money value={data.totals?.[0]?.monthly} currency={data.totals?.[0]?.currency} className="text-xl font-semibold" /></Card><Card className="p-4"><p className="text-xs text-muted-foreground">Yearly</p><Money value={data.totals?.[0]?.yearly} currency={data.totals?.[0]?.currency} className="text-xl font-semibold" /></Card></div>
        <Card><ul className="divide-y">{subs.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1"><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.billingFrequency} · next {fmtDate(s.nextBillingDate)}</p></div>
            <Badge tone={s.status === 'active' ? 'good' : 'neutral'}>{s.status}</Badge>
            <Money value={s.amount} currency={s.currency} />
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: s.id, op: s.status === 'active' ? 'cancel' : 'reactivate' })}>{s.status === 'active' ? 'Mark cancelled' : 'Reactivate'}</Button>
          </li>))}</ul></Card></>)}
      <Modal open={open} onOpenChange={setOpen} title="Add subscription">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ name: v.name, amount: v.amount, billingFrequency: v.billingFrequency, nextBillingDate: iso(v.nextBillingDate) } as any))} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} /></Field>
          <Field label="Amount" error={f.formState.errors.amount?.message}><Input inputMode="decimal" {...f.register('amount')} /></Field>
          <Field label="Billing"><Select {...f.register('billingFrequency')}>{FREQ.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Next billing date"><Input type="date" {...f.register('nextBillingDate')} /></Field>
          {create.error && <PlanGate error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Save</Button>
        </form>
      </Modal>
    </div>
  );
}
