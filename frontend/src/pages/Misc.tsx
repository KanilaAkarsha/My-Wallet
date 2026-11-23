import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/utils';
import { PlanGate } from './Planning';

/* ---------- Categories ---------- */
const catSchema = z.object({ name: z.string().trim().min(1, 'Required').max(60), kind: z.enum(['income', 'expense']) });
export function CategoriesPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useGet<{ categories: any[] }>(['categories'], '/categories');
  const f = useForm<z.infer<typeof catSchema>>({ resolver: zodResolver(catSchema), defaultValues: { kind: 'expense' } });
  const create = useSend('POST', '/categories', { onSuccess: () => { setOpen(false); f.reset(); } });
  const remove = useSend<any, string>('DELETE', (id) => `/categories/${id}`);
  const rename = useSend<any, { id: string; name: string }>('PATCH', (b) => `/categories/${b.id}`);
  const cats = data?.categories ?? [];
  return (
    <div>
      <PageHeader title="Categories" action={<Button onClick={() => setOpen(true)}>Add category</Button>} />
      {error ? <ErrorBox error={error} /> : isLoading ? <Skeleton className="h-40" /> : (
        <div className="grid gap-4 md:grid-cols-2">{(['expense', 'income'] as const).map((k) => (
          <Card key={k}><h2 className="px-4 pt-4 text-sm font-semibold capitalize text-muted-foreground">{k}</h2>
            <ul className="divide-y p-2 text-sm">{cats.filter((c) => c.kind === k).map((c) => <li key={c.id} className="flex items-center justify-between px-2 py-2"><span>{c.name}</span>{c.isSystem ? <Badge>default</Badge> : <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { const n = window.prompt('Rename category', c.name)?.trim(); if (n && n !== c.name) rename.mutate({ id: c.id, name: n }); }}>Rename</Button><Button size="sm" variant="ghost" onClick={() => window.confirm('Archive this category?') && remove.mutate(c.id)}>Archive</Button></span>}</li>)}</ul></Card>
        ))}</div>
      )}
      <Modal open={open} onOpenChange={setOpen} title="Add category">
        <form onSubmit={f.handleSubmit((v) => create.mutate(v as any))} className="space-y-4" noValidate>
          <Field label="Name" error={f.formState.errors.name?.message}><Input {...f.register('name')} /></Field>
          <Field label="Kind"><Select {...f.register('kind')}><option value="expense">Expense</option><option value="income">Income</option></Select></Field>
          {create.error && <ErrorBox error={create.error} />}
          <Button type="submit" className="w-full" loading={create.isPending}>Save</Button>
        </form>
      </Modal>
    </div>
  );
}

/* ---------- Reports ---------- */
export function ReportsPage() {
  const list = useGet<any>(['reports'], '/reports');
  const [name, setName] = useState('monthly-expenses');
  const report = useGet<any>(['report', name], `/reports/${name}`, { format: 'json' });
  const reports: any[] = list.data?.reports ?? [];
  const sel = reports.find((r) => r.name === name);
  return (
    <div className="space-y-4">
      <PageHeader title="Reports" sub={list.data?.historyWindowMonths ? `Your plan covers the last ${list.data.historyWindowMonths} months of reporting. Your stored history is never removed.` : undefined}
        action={<a href="/api/v1/reports/transactions.csv"><Button variant="outline">Download all transactions (CSV)</Button></a>} />
      <Select value={name} onChange={(e) => setName(e.target.value)} aria-label="Report" className="max-w-xs">{reports.map((r) => <option key={r.name} value={r.name}>{r.name.replace(/-/g, ' ')}{r.available ? '' : ' (upgrade)'}</option>)}</Select>
      {report.error ? <PlanGate error={report.error} /> : report.isLoading ? <Skeleton className="h-48" /> : report.data && (
        <Card className="overflow-x-auto">
          <div className="flex items-center justify-between p-4"><div><h2 className="font-semibold">{report.data.title}</h2><p className="text-xs text-muted-foreground">{report.data.subtitle}</p></div>
            <div className="flex gap-2"><a href={`/api/v1/reports/${name}?format=csv`}><Button size="sm" variant="outline">CSV</Button></a><a href={`/api/v1/reports/${name}?format=pdf`}><Button size="sm" variant="outline">PDF</Button></a></div></div>
          {report.data.window?.limitedByPlan && <p className="px-4 pb-2 text-xs text-warn">Shortened to your plan's {report.data.window.planMonths}-month reporting window.</p>}
          <table className="w-full text-sm"><thead><tr className="border-y bg-muted/50 text-left">{report.data.columns.map((c: string) => <th key={c} className="px-4 py-2 font-medium">{c}</th>)}</tr></thead>
            <tbody>{report.data.rows.map((r: string[], i: number) => <tr key={i} className="border-b last:border-0">{r.map((c, j) => <td key={j} className={`px-4 py-2 ${j ? 'num' : ''}`}>{c}</td>)}</tr>)}</tbody></table>
          {!report.data.rows.length && <Empty title="No data for this report yet" />}
        </Card>)}
      {sel && !sel.available && <p className="text-sm text-muted-foreground">This report needs a higher plan.</p>}
    </div>
  );
}

/* ---------- Insights ---------- */
export function InsightsPage() {
  const { data, isLoading, error } = useGet<{ insights: any[] }>(['insights'], '/insights');
  const refresh = useSend('POST', '/insights/refresh');
  const dismiss = useSend<any, string>('POST', (id) => `/insights/${id}/dismiss`);
  return (
    <div>
      <PageHeader title="Insights" sub="Rule-based observations from your own data — not financial advice." action={<Button variant="outline" onClick={() => refresh.mutate({})} loading={refresh.isPending}>Refresh</Button>} />
      {error ? <PlanGate error={error} /> : isLoading ? <Skeleton className="h-32" /> : !data?.insights.length ? <Card><Empty title="No insights right now" hint="Insights appear as you add more transactions." /></Card> : (
        <div className="space-y-3">{data.insights.map((i) => (
          <Card key={i.id} className="space-y-1 p-4"><div className="flex items-start justify-between gap-2"><div className="flex items-center gap-2"><Badge tone={i.severity === 'critical' ? 'bad' : i.severity === 'warning' ? 'warn' : 'neutral'}>{i.severity}</Badge><span className="font-medium">{i.headline}</span></div><Button size="sm" variant="ghost" onClick={() => dismiss.mutate(i.id)}>Dismiss</Button></div>
            {i.detail && <p className="text-sm text-muted-foreground">{i.detail}</p>}{i.suggestion && <p className="text-sm">{i.suggestion}</p>}</Card>))}</div>)}
    </div>
  );
}

/* ---------- Notifications ---------- */
export function NotificationsPage() {
  const { data, isLoading, error } = useGet<{ items: any[]; unreadCount: number }>(['notifications'], '/notifications', { limit: 50 });
  const readAll = useSend('POST', '/notifications/read-all');
  const read = useSend<any, string>('POST', (id) => `/notifications/${id}/read`);
  return (
    <div>
      <PageHeader title="Notifications" action={<Button variant="outline" disabled={!data?.unreadCount} onClick={() => readAll.mutate({})}>Mark all read</Button>} />
      {error ? <ErrorBox error={error} /> : isLoading ? <Skeleton className="h-32" /> : !data?.items.length ? <Card><Empty title="You're all caught up" /></Card> : (
        <Card><ul className="divide-y">{data.items.map((n) => (
          <li key={n.id} className="flex items-start gap-3 p-4 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand'}`} />
            <div className="min-w-0 flex-1"><p className="font-medium">{n.link ? <Link className="hover:underline" to={n.link} onClick={() => !n.read && read.mutate(n.id)}>{n.title}</Link> : n.title}</p>{n.body && <p className="text-muted-foreground">{n.body}</p>}<p className="text-xs text-muted-foreground">{fmtDate(n.createdAt)}</p></div>
            {!n.read && <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>Mark read</Button>}
          </li>))}</ul></Card>)}
    </div>
  );
}
