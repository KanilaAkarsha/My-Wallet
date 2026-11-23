import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TransactionForm } from '@/components/TransactionForm';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Money, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { api, uploadFile } from '@/lib/api';
import { cn, fmtDate } from '@/lib/utils';

const signOf = (t: any): 'in' | 'out' | 'neutral' => {
  if (t.type === 'income') return 'in';
  if (t.type === 'expense' || t.type === 'loan_interest') return 'out';
  if (t.type === 'refund') return 'in';
  return t.direction === 'in' ? 'in' : t.direction === 'out' ? 'out' : 'neutral';
};

export function TxRow({ t }: { t: any }) {
  const s = signOf(t);
  const Icon = t.type === 'transfer' ? ArrowLeftRight : s === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <li>
      <Link to={`/transactions/${t.id}`} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', s === 'in' ? 'bg-brand-soft text-income' : s === 'out' ? 'bg-expense/10 text-expense' : 'bg-muted text-muted-foreground')}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t.title}</span>
          <span className="block text-xs text-muted-foreground">{fmtDate(t.date)} · <span className="capitalize">{t.type.replace('_', ' ')}</span>{t.status !== 'posted' && <> · <span className="capitalize">{t.status}</span></>}</span>
        </span>
        <Money value={t.amount} currency={t.currency} sign tone={s === 'in' ? 'income' : s === 'out' ? 'expense' : undefined} className="text-sm font-medium" />
      </Link>
    </li>
  );
}

export function TransactionsPage({ fixedType, title }: { fixedType?: 'income' | 'expense'; title?: string }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [type, setType] = useState(fixedType ?? '');
  const [accountId, setAccountId] = useState('');
  const [open, setOpen] = useState(false);
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['transactions', dq, type, accountId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api('GET', '/transactions', undefined, { query: { q: dq, type, accountId, limit: 25, cursor: pageParam } }),
    getNextPageParam: (p: any) => p.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p: any) => p.items) ?? [];
  return (
    <div>
      <PageHeader title={title ?? 'Transactions'} action={<Button onClick={() => setOpen(true)}>Add transaction</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Search title, notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {!fixedType && <Select value={type} onChange={(e) => setType(e.target.value as any)} aria-label="Type"><option value="">All types</option>{['income', 'expense', 'transfer', 'refund', 'adjustment', 'loan_interest'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select>}
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account"><option value="">All accounts</option>{(accounts.data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      </div>
      <Card>
        {list.error ? <div className="p-4"><ErrorBox error={list.error} retry={() => void list.refetch()} /></div>
          : list.isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : items.length === 0 ? <Empty title="No transactions found" hint={dq || accountId ? 'Try changing your filters.' : 'Add your first transaction to get started.'} action={<Button onClick={() => setOpen(true)}>Add transaction</Button>} />
          : <ul className="divide-y p-2">{items.map((t: any) => <TxRow key={t.id} t={t} />)}</ul>}
        {list.hasNextPage && <div className="border-t p-3 text-center"><Button variant="outline" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
      </Card>
      <TransactionForm open={open} onOpenChange={setOpen} defaultType={fixedType ?? 'expense'} />
    </div>
  );
}

export const NewTransactionPage = () => { const nav = useNavigate(); return <TransactionForm open onOpenChange={(o) => !o && nav('/transactions')} />; };

function Attachments({ t }: { t: any }) {
  const qc = useQueryClient();
  const up = useMutation({ mutationFn: (f: File) => uploadFile(f, { kind: 'receipt', transactionId: t.id }), onSuccess: () => void qc.invalidateQueries() });
  const del = useSend<any, string>('DELETE', (id) => `/attachments/${id}`);
  return (
    <div className="space-y-2 border-t pt-4">
      <h2 className="text-sm font-semibold">Receipts</h2>
      {t.attachmentIds.length === 0 && <p className="text-sm text-muted-foreground">No receipts attached.</p>}
      <ul className="space-y-1 text-sm">{t.attachmentIds.map((id: string, i: number) => <li key={id} className="flex items-center justify-between"><a className="text-brand underline" href={`/api/v1/attachments/${id}`} target="_blank" rel="noreferrer">Receipt {i + 1}</a><Button size="sm" variant="ghost" onClick={() => window.confirm('Delete this receipt?') && del.mutate(id)}>Delete</Button></li>)}</ul>
      <label className="inline-block"><span className="sr-only">Attach receipt</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} /></label>
      {up.isPending && <p className="text-xs text-muted-foreground">Uploading…</p>}
      {(up.error || del.error) && <ErrorBox error={up.error ?? del.error} />}
      <p className="text-xs text-muted-foreground">Images or PDF, up to 5 MB. File type is verified on the server.</p>
    </div>
  );
}

function EditTransaction({ t, open, onOpenChange }: { t: any; open: boolean; onOpenChange: (o: boolean) => void }) {
  const draft = t.status === 'pending';
  const cats = useGet<{ categories: any[] }>(['categories'], '/categories');
  const f = useForm<{ title: string; amount: string; categoryId: string; notes: string; tags: string; date: string }>({ values: { title: t.title, amount: t.amount ?? '', categoryId: t.categoryId ?? '', notes: t.notes ?? '', tags: (t.tags ?? []).join(', '), date: String(t.date).slice(0, 10) } });
  const save = useSend('PATCH', `/transactions/${t.id}`, { onSuccess: () => onOpenChange(false) });
  const kind = t.type === 'income' ? 'income' : 'expense';
  const submit = f.handleSubmit((v) => save.mutate({
    title: v.title, notes: v.notes || null, categoryId: v.categoryId || null,
    tags: v.tags.split(',').map((x) => x.trim()).filter(Boolean),
    ...(draft ? { amount: v.amount, date: new Date(`${v.date}T12:00:00+05:30`).toISOString() } : {}),
  } as any));
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Edit transaction">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!draft && <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Posted transactions keep their amount, account and date. Reverse and re-enter to change those.</p>}
        <Field label="Title"><Input {...f.register('title', { required: true })} /></Field>
        {draft && <><Field label="Amount"><Input inputMode="decimal" {...f.register('amount')} /></Field><Field label="Date"><Input type="date" {...f.register('date')} /></Field></>}
        {t.type !== 'transfer' && t.type !== 'adjustment' && <Field label="Category"><Select {...f.register('categoryId')}><option value="">Uncategorised</option>{(cats.data?.categories ?? []).filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Tags (comma separated)"><Input {...f.register('tags')} /></Field>
        <Field label="Notes"><Textarea rows={3} {...f.register('notes')} /></Field>
        {save.error && <ErrorBox error={save.error} />}
        <Button type="submit" className="w-full" loading={save.isPending}>Save changes</Button>
      </form>
    </Modal>
  );
}

export function TransactionDetail() {
  const [editing, setEditing] = useState(false);
  const { id } = useParams();
  const nav = useNavigate();
  const { data: t, isLoading, error } = useGet<any>(['transaction'], `/transactions/${id}`);
  const post = useSend('POST', `/transactions/${id}/post`);
  const reverse = useSend('POST', `/transactions/${id}/reverse`, { idempotent: true });
  const remove = useSend('DELETE', `/transactions/${id}`, { onSuccess: () => nav('/transactions') });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !t) return <Skeleton className="h-64" />;
  const canReverse = t.status === 'posted' && !t.reversalOf && !t.reversedById && t.type !== 'transfer';
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t.title} sub={`${fmtDate(t.date)} · ${t.type.replace('_', ' ')}`} />
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><Money value={t.amount} currency={t.currency} className="text-3xl font-semibold" /><Badge tone={t.status === 'posted' ? 'good' : t.status === 'reversed' ? 'bad' : 'neutral'}>{t.status}</Badge></div>
        {t.description && <p className="text-sm">{t.description}</p>}
        {t.notes && <p className="text-sm text-muted-foreground">{t.notes}</p>}
        {t.reversedById && <p className="text-sm text-warn">This transaction was reversed by an offsetting entry; the original stays on record.</p>}
        {t.reversalOf && <p className="text-sm text-muted-foreground">This is a reversal entry.</p>}
        {(post.error || reverse.error || remove.error) && <ErrorBox error={post.error ?? reverse.error ?? remove.error} />}
        <div className="flex flex-wrap gap-2">
          {t.status === 'pending' && <><Button onClick={() => post.mutate({})} loading={post.isPending}>Post</Button><Button variant="danger" onClick={() => remove.mutate({})} loading={remove.isPending}>Delete draft</Button></>}
          {canReverse && <Button variant="outline" onClick={() => window.confirm('Reverse this transaction? An offsetting entry will be recorded; the original is kept.') && reverse.mutate({})} loading={reverse.isPending}><RotateCcw className="h-4 w-4" />Reverse</Button>}
          {t.status !== 'reversed' && t.type !== 'transfer' && !t.reversalOf && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          <Button variant="ghost" onClick={() => nav(-1)}>Back</Button>
        </div>
        {t.status !== 'failed' && <Attachments t={t} />}
        <p className="text-xs text-muted-foreground">Posted transactions are never edited or deleted — reversing records a matching opposite entry so your history stays auditable.</p>
      </Card>
      <EditTransaction t={t} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
