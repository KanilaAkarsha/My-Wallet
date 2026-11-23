import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Money, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/utils';
import { TxRow } from './Transactions';

const TYPES = ['cash', 'bank', 'savings', 'current', 'ewallet', 'other'];
const schema = z.object({ name: z.string().trim().min(1, 'Name required').max(80), type: z.string(), openingBalance: z.string().regex(/^-?\d{1,15}(\.\d{1,2})?$/, 'e.g. 5000 or 5000.50') });

export function AccountsPage() {
  const { data, isLoading, error, refetch } = useGet<{ accounts: any[]; totals: any[] }>(['accounts'], '/accounts');
  const [open, setOpen] = useState(false);
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { type: 'bank', openingBalance: '0' } });
  const create = useSend('POST', '/accounts', { onSuccess: () => { setOpen(false); f.reset(); } });
  const accounts = data?.accounts ?? [];
  return (
    <div>
      <PageHeader title="Accounts" sub="Balances are computed from your transaction history." action={<Button onClick={() => setOpen(true)}>Add account</Button>} />
      {error ? <ErrorBox error={error} retry={() => void refetch()} /> : isLoading ? <Skeleton className="h-40" /> : accounts.length === 0 ? <Card><Empty title="No accounts yet" hint="Add cash, a bank account or an e-wallet." action={<Button onClick={() => setOpen(true)}>Add account</Button>} /></Card> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">{data?.totals.map((t) => <Card key={t.currency} className="px-4 py-3"><p className="text-xs text-muted-foreground">Total ({t.currency})</p><Money value={t.total} currency={t.currency} className="text-xl font-semibold" /></Card>)}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <Link key={a.id} to={`/accounts/${a.id}`}>
                <Card className="p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between"><span className="font-medium">{a.name}</span><Badge tone={a.status === 'active' ? 'neutral' : 'warn'}>{a.status === 'active' ? a.type : a.status}</Badge></div>
                  <Money value={a.balance} currency={a.currency} className="mt-3 block text-2xl font-semibold" />
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
      <Modal open={open} onOpenChange={setOpen} title="Add account">
        <form onSubmit={f.handleSubmit((v) => create.mutate(v as any))} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} placeholder="e.g. Commercial Bank" /></Field>
          <Field label="Type"><Select {...f.register('type')}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Opening balance" hint="Your balance today. History you add later is included on top." error={f.formState.errors.openingBalance?.message}><Input inputMode="decimal" {...f.register('openingBalance')} /></Field>
          {create.error && <ErrorBox error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Create account</Button>
        </form>
      </Modal>
    </div>
  );
}

export function AccountDetail() {
  const { id } = useParams();
  const { data: a, error } = useGet<any>(['account'], `/accounts/${id}`);
  const txs = useGet<{ items: any[] }>(['transactions', 'acct'], '/transactions', { accountId: id, limit: 15 });
  const archive = useSend('POST', `/accounts/${id}/${a?.status === 'archived' ? 'unarchive' : 'archive'}`);
  const [stmt, setStmt] = useState('');
  const [res, setRes] = useState<any>(null);
  const reconcile = useSend<any, { statementBalance: string }>('POST', `/accounts/${id}/reconcile`, { onSuccess: setRes });
  if (error) return <ErrorBox error={error} />;
  if (!a) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <PageHeader title={a.name} sub={`${a.type} · ${a.currency}`} action={<Button variant="outline" onClick={() => archive.mutate({})} loading={archive.isPending}>{a.status === 'archived' ? 'Unarchive' : 'Archive'}</Button>} />
      <Card className="p-5"><p className="text-sm text-muted-foreground">Current balance</p><Money value={a.balance} currency={a.currency} className="text-3xl font-semibold" /><p className="mt-1 text-xs text-muted-foreground">Opening {a.openingBalance} · last reconciled {fmtDate(a.lastReconciledAt)}</p></Card>
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Reconcile with your statement</h2>
        <div className="flex gap-2"><Input inputMode="decimal" placeholder="Statement balance" value={stmt} onChange={(e) => setStmt(e.target.value)} aria-label="Statement balance" /><Button variant="outline" onClick={() => reconcile.mutate({ statementBalance: stmt })} loading={reconcile.isPending} disabled={!stmt}>Check</Button></div>
        {reconcile.error && <ErrorBox error={reconcile.error} />}
        {res && <p className="text-sm">{res.reconciled ? <Badge tone="good">Balances match</Badge> : <>Difference <Money value={res.difference} currency={a.currency} tone="auto" />. {res.hint}</>}</p>}
      </Card>
      <Card><div className="px-4 pt-4 text-sm font-semibold text-muted-foreground">Recent activity</div>{txs.data?.items.length ? <ul className="divide-y p-2">{txs.data.items.map((t) => <TxRow key={t.id} t={t} />)}</ul> : <Empty title="No activity" />}</Card>
    </div>
  );
}
