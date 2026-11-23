import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Money, PageHeader, Select } from '@/components/ui/primitives';
import { fmtDate, toInputDate } from '@/lib/utils';

const schema = z.object({ fromAccountId: z.string().min(1, 'Choose source'), toAccountId: z.string().min(1, 'Choose destination'), amount: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Enter an amount'), date: z.string(), description: z.string().max(200).optional(), rate: z.string().optional() })
  .refine((v) => v.fromAccountId !== v.toAccountId, { path: ['toAccountId'], message: 'Must differ from source' });

export function TransfersPage() {
  const [open, setOpen] = useState(false);
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const list = useGet<{ items: any[] }>(['transfers'], '/transfers', { limit: 50 });
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { date: toInputDate() } });
  const active = (accounts.data?.accounts ?? []).filter((a) => a.status === 'active');
  const to = active.find((a) => a.id === f.watch('toAccountId'));
  const from = active.find((a) => a.id === f.watch('fromAccountId'));
  const cross = !!to && !!from && to.currency !== from.currency;
  const create = useSend('POST', '/transfers', { idempotent: true, onSuccess: () => { setOpen(false); f.reset({ date: toInputDate() }); } });
  const reverse = useSend<any, string>('POST', (g) => `/transfers/${g}/reverse`, { idempotent: true });
  const rows = list.data?.items ?? [];
  return (
    <div>
      <PageHeader title="Transfers" sub="Moving money between your own accounts is not income or an expense." action={<Button onClick={() => setOpen(true)} disabled={active.length < 2}>New transfer</Button>} />
      {active.length < 2 && !accounts.isLoading && <p className="mb-3 text-sm text-muted-foreground">You need at least two accounts to transfer.</p>}
      {list.error ? <ErrorBox error={list.error} /> : null}
      <Card>{rows.length === 0 ? <Empty title="No transfers yet" /> : <ul className="divide-y">{rows.map((t) => {
        const a = active.find((x) => x.id === t.fromAccountId); const b = active.find((x) => x.id === t.toAccountId);
        return (<li key={t.groupId} className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <div className="min-w-0 flex-1"><p className="font-medium">{a?.name ?? 'Account'} → {b?.name ?? 'Account'}</p><p className="text-xs text-muted-foreground">{fmtDate(t.date)}{t.description ? ` · ${t.description}` : ''}{t.conversion ? ` · rate ${t.conversion.rate}` : ''}</p></div>
          <Money value={t.amount} currency={t.currency} className="font-medium" />
          {t.status === 'reversed' ? <Badge tone="bad">reversed</Badge> : <Button size="sm" variant="ghost" loading={reverse.isPending} onClick={() => window.confirm('Reverse both legs of this transfer?') && reverse.mutate(t.groupId)}>Reverse</Button>}
        </li>);
      })}</ul>}</Card>
      {reverse.error && <div className="mt-3"><ErrorBox error={reverse.error} /></div>}
      <Modal open={open} onOpenChange={setOpen} title="New transfer">
        <form onSubmit={f.handleSubmit((v) => create.mutate({ fromAccountId: v.fromAccountId, toAccountId: v.toAccountId, amount: v.amount, date: new Date(`${v.date}T12:00:00+05:30`).toISOString(), ...(v.description ? { description: v.description } : {}), ...(cross && v.rate ? { rate: v.rate } : {}) } as any))} className="space-y-4" noValidate>
          <Field label="From" error={f.formState.errors.fromAccountId?.message}><Select {...f.register('fromAccountId')}><option value="">Select…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}</Select></Field>
          <Field label="To" error={f.formState.errors.toAccountId?.message}><Select {...f.register('toAccountId')}><option value="">Select…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}</Select></Field>
          <Field label={`Amount${from ? ` (${from.currency})` : ''}`} error={f.formState.errors.amount?.message}><Input inputMode="decimal" {...f.register('amount')} /></Field>
          {cross && <Field label={`Exchange rate (1 ${from.currency} = ? ${to.currency})`} hint="Enter the rate you actually received. It is stored with the transfer."><Input inputMode="decimal" {...f.register('rate')} /></Field>}
          <Field label="Date"><Input type="date" {...f.register('date')} /></Field>
          <Field label="Note (optional)"><Input {...f.register('description')} /></Field>
          {create.error && <ErrorBox error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Transfer</Button>
        </form>
      </Modal>
    </div>
  );
}
