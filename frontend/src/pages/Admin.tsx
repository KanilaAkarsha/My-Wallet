import { useState } from 'react';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, CardHeader, ErrorBox, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/utils';

export default function AdminPage() {
  const [q, setQ] = useState('');
  const stats = useGet<any>(['admin', 'stats'], '/admin/stats');
  const users = useGet<{ items: any[] }>(['admin', 'users'], '/admin/users', { q, limit: 30 });
  const audit = useGet<{ items: any[] }>(['admin', 'audit'], '/admin/audit');
  const setStatus = useSend<any, { id: string; status: string }>('PATCH', (b) => `/admin/users/${b.id}/status`);
  if (stats.error) return <ErrorBox error={stats.error} />;
  const s = stats.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Admin" sub="Account metadata and platform health only — no financial data is shown here." />
      {!s ? <Skeleton className="h-24" /> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Users', s.users], ['Active (30d)', s.activeLast30Days], ['Suspended', s.suspended], ['Signups (30d)', s.signupsLast30Days]].map(([l, v]) => <Card key={String(l)} className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="num text-2xl font-semibold">{v}</p></Card>)}</div>}
      <Card><CardHeader title="Users" action={<Input className="max-w-52" placeholder="Search email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />} />
        <ul className="divide-y p-2 text-sm">{users.data?.items.map((u) => <li key={u.id} className="flex flex-wrap items-center gap-2 px-2 py-2"><span className="min-w-0 flex-1 truncate">{u.email}<span className="block text-xs text-muted-foreground">joined {fmtDate(u.createdAt)} · {u.plan ?? 'free'}</span></span><Badge tone={u.status === 'active' ? 'good' : 'bad'}>{u.status}</Badge><Badge>{u.role}</Badge>
          <Button size="sm" variant="ghost" onClick={() => window.confirm(`${u.status === 'active' ? 'Suspend' : 'Reactivate'} ${u.email}?`) && setStatus.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}>{u.status === 'active' ? 'Suspend' : 'Reactivate'}</Button></li>)}</ul></Card>
      <Card><CardHeader title="Audit log" /><ul className="divide-y p-2 text-xs">{audit.data?.items.slice(0, 30).map((a) => <li key={a.id} className="flex justify-between px-2 py-1.5"><span>{a.action}</span><span className="text-muted-foreground">{a.actorRole} · {fmtDate(a.at)}</span></li>)}</ul></Card>
    </div>
  );
}
