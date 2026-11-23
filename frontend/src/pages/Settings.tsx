import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Progress, Select, Skeleton, Toggle } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { cn, fmtDate } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { useUI } from '@/store/ui';
import { PlanGate } from './Planning';
import { passwordRule } from './auth';

const TABS = [['profile', 'Profile'], ['preferences', 'Preferences'], ['security', 'Security'], ['billing', 'Plan & billing'], ['data', 'Privacy & data']] as const;

export function SettingsPage() {
  const { tab = 'profile' } = useParams();
  if (!TABS.some(([t]) => t === tab) && tab !== 'subscription') return <Navigate to="/settings/profile" replace />;
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-4 flex gap-1 overflow-x-auto" role="tablist">{TABS.map(([t, l]) => <NavLink key={t} to={`/settings/${t}`} role="tab" className={({ isActive }) => cn('whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-muted-foreground hover:bg-muted')}>{l}</NavLink>)}</div>
      {tab === 'profile' && <ProfileTab />}{tab === 'preferences' && <PreferencesTab />}{tab === 'security' && <SecurityTab />}{(tab === 'billing' || tab === 'subscription') && <BillingTab />}{tab === 'data' && <DataTab />}
    </div>
  );
}

function ProfileTab() {
  const { data: p, isLoading } = useGet<any>(['profile'], '/profile');
  const f = useForm<{ displayName: string; currency: string; occupation: string; student: boolean; youngProfessional: boolean }>();
  useEffect(() => { if (p) f.reset({ displayName: p.displayName ?? '', currency: p.currency, occupation: p.occupation ?? '', student: p.modes.student, youngProfessional: p.modes.youngProfessional }); }, [p, f]);
  const save = useSend('PATCH', '/profile');
  if (isLoading) return <Skeleton className="h-48" />;
  return (
    <Card className="p-5"><form onSubmit={f.handleSubmit((v) => save.mutate({ displayName: v.displayName || undefined, currency: v.currency, occupation: v.occupation || null, modes: { student: v.student, youngProfessional: v.youngProfessional } } as any))} className="max-w-md space-y-4">
      <Field label="Display name"><Input {...f.register('displayName')} /></Field>
      <Field label="Currency"><Select {...f.register('currency')}>{['LKR', 'USD', 'EUR', 'GBP', 'INR', 'AUD'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Occupation"><Select {...f.register('occupation')}><option value="">Prefer not to say</option><option value="student">Student</option><option value="employed">Employed</option><option value="freelancer">Freelancer</option><option value="other">Other</option></Select></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('student')} /> Student mode (allowance & semester planning)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('youngProfessional')} /> Young professional mode (salary & emergency fund planning)</label>
      {save.error && <ErrorBox error={save.error} />}{save.isSuccess && <p className="text-sm text-brand">Saved.</p>}
      <Button type="submit" loading={save.isPending}>Save changes</Button>
    </form></Card>
  );
}

function PreferencesTab() {
  const { theme, setTheme, hideBalances, setHide } = useUI();
  const { data: p } = useGet<any>(['profile'], '/profile');
  const save = useSend('PATCH', '/profile');
  return (
    <Card className="max-w-lg space-y-5 p-5">
      <Field label="Theme"><Select value={theme} onChange={(e) => { setTheme(e.target.value as any); save.mutate({ theme: e.target.value } as any); }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></Select></Field>
      <div className="flex items-center justify-between"><span className="text-sm">Hide balances by default</span><Toggle label="Hide balances" checked={hideBalances} onChange={(v) => { setHide(v); save.mutate({ hideBalances: v } as any); }} /></div>
      {p && <>
        <div className="flex items-center justify-between"><span className="text-sm">In-app notifications</span><Toggle label="In-app notifications" checked={p.notificationPrefs.inApp} onChange={(v) => save.mutate({ notificationPrefs: { inApp: v } } as any)} /></div>
        <div className="flex items-center justify-between"><span className="text-sm">Hide amounts inside notifications</span><Toggle label="Mask amounts in notifications" checked={p.notificationPrefs.maskAmounts} onChange={(v) => save.mutate({ notificationPrefs: { maskAmounts: v } } as any)} /></div>
      </>}
    </Card>
  );
}

function SecurityTab() {
  const { me, load } = useAuth();
  const sessions = useGet<{ sessions: any[] }>(['sessions'], '/auth/sessions');
  const pw = useForm<{ currentPassword: string; newPassword: string }>({ resolver: zodResolver(z.object({ currentPassword: z.string().min(1, 'Required'), newPassword: passwordRule })) });
  const change = useSend('POST', '/auth/change-password', { onSuccess: () => pw.reset() });
  const revoke = useSend<any, string>('DELETE', (id) => `/auth/sessions/${id}`);
  const revokeOthers = useSend('POST', '/auth/sessions/revoke-others');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); await load(); } catch (e) { setErr(e); } };
  return (
    <div className="max-w-2xl space-y-4">
      <Card className="p-5"><h2 className="mb-3 text-sm font-semibold">Change password</h2>
        <form onSubmit={pw.handleSubmit((v) => change.mutate(v as any))} className="max-w-sm space-y-3" noValidate>
          <Field label="Current password" error={pw.formState.errors.currentPassword?.message}><Input type="password" autoComplete="current-password" {...pw.register('currentPassword')} /></Field>
          <Field label="New password" hint="12+ characters" error={pw.formState.errors.newPassword?.message}><Input type="password" autoComplete="new-password" {...pw.register('newPassword')} /></Field>
          {change.error && <ErrorBox error={change.error} />}{change.isSuccess && <p className="text-sm text-brand">Password updated.</p>}
          <Button type="submit" loading={change.isPending}>Update password</Button></form></Card>
      <Card className="space-y-3 p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Two-factor authentication</h2><Badge tone={me?.twoFactorEnabled ? 'good' : 'neutral'}>{me?.twoFactorEnabled ? 'On' : 'Off'}</Badge></div>
        {!me?.twoFactorEnabled && !setup && <Button variant="outline" onClick={() => void run(async () => setSetup(await post('/auth/2fa/setup')))}>Set up authenticator app</Button>}
        {setup && !codes && <div className="space-y-2 text-sm"><p>Add this key to your authenticator app, then enter the 6-digit code.</p><code className="block break-all rounded bg-muted p-2">{setup.secret}</code>
          <div className="flex gap-2"><Input inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Authenticator code" /><Button onClick={() => void run(async () => { const r = await post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code }); setCodes(r.recoveryCodes); setSetup(null); setCode(''); })}>Enable</Button></div></div>}
        {codes && <div className="space-y-2 text-sm"><p className="font-medium">Save these recovery codes now — they won’t be shown again.</p><ul className="grid grid-cols-2 gap-1 rounded bg-muted p-3 font-mono">{codes.map((c) => <li key={c}>{c}</li>)}</ul><Button variant="outline" onClick={() => setCodes(null)}>I’ve saved them</Button></div>}
        {me?.twoFactorEnabled && !codes && <div className="flex flex-wrap gap-2"><Input type="password" placeholder="Password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} className="max-w-48" aria-label="Password" /><Input inputMode="numeric" maxLength={6} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-32" aria-label="Code" /><Button variant="danger" onClick={() => void run(async () => { await post('/auth/2fa/disable', { password: disablePw, code }); setDisablePw(''); setCode(''); })}>Disable</Button></div>}
        {err ? <ErrorBox error={err} /> : null}</Card>
      <Card><CardHeader title="Active sessions" action={<Button size="sm" variant="outline" onClick={() => revokeOthers.mutate({})}>Sign out others</Button>} />
        <ul className="divide-y p-2 text-sm">{sessions.data?.sessions.map((s) => <li key={s.id} className="flex items-center justify-between px-2 py-2"><span>{s.userAgent ?? 'Device'} <span className="text-xs text-muted-foreground">· {fmtDate(s.lastSeenAt ?? s.createdAt)}</span></span>{s.current ? <Badge tone="good">this device</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}</li>)}</ul></Card>
    </div>
  );
}

function BillingTab() {
  const { data, isLoading, error } = useGet<any>(['billing'], '/billing');
  const trial = useSend('POST', '/billing/trial');
  const downgrade = useSend('POST', '/billing/downgrade');
  const cancel = useSend('POST', '/billing/cancel');
  const checkout = useSend<any, { planCode: string }>('POST', '/billing/checkout', { onSuccess: (d) => { if (d?.url) window.location.href = d.url; } });
  if (error) return <ErrorBox error={error} />;
  if (isLoading || !data) return <Skeleton className="h-48" />;
  return (
    <div className="max-w-3xl space-y-4">
      <Card className="space-y-2 p-5"><div className="flex items-center gap-2"><h2 className="font-semibold capitalize">{data.current.code} plan</h2><Badge tone="good">{data.current.status}</Badge></div>
        {data.current.trialEndsAt && <p className="text-sm text-muted-foreground">Trial ends {fmtDate(data.current.trialEndsAt)}</p>}
        <div className="space-y-2 pt-2">{data.usage.map((u: any) => <div key={u.key} className="space-y-1 text-sm"><div className="flex justify-between capitalize"><span>{u.key.replace(/([A-Z])/g, ' $1')}</span><span className="num text-muted-foreground">{u.used} / {u.limit}</span></div><Progress value={u.limit ? (u.used / u.limit) * 100 : 100} tone={u.overLimit ? 'bad' : undefined} /></div>)}</div>
        <p className="text-xs text-muted-foreground">Limits only stop you creating new items; your existing data and history are never hidden or deleted.</p></Card>
      {!data.providerConfigured && <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Online payments are not configured on this server, so paid upgrades are unavailable. Free trials still work.</p>}
      <div className="grid gap-3 sm:grid-cols-3">{data.plans.map((p: any) => (
        <Card key={p.code} className="space-y-2 p-4"><p className="font-semibold">{p.name}</p><p className="text-lg">{p.price}<span className="text-xs text-muted-foreground"> / {p.interval}</span></p>
          {data.current.code === p.code ? <Badge tone="good">Current</Badge> : p.code === 'free' ? <Button size="sm" variant="outline" onClick={() => downgrade.mutate({ planCode: 'free' })}>Downgrade</Button> : (<div className="flex flex-col gap-1.5">
            {p.trialDays > 0 && data.current.code === 'free' && <Button size="sm" variant="outline" onClick={() => trial.mutate({ planCode: p.code })}>Start {p.trialDays}-day trial</Button>}
            {data.providerConfigured && <Button size="sm" onClick={() => checkout.mutate({ planCode: p.code })}>Upgrade</Button>}</div>)}</Card>))}</div>
      <PlanGate error={trial.error ?? downgrade.error ?? checkout.error ?? cancel.error} />
      {data.current.code !== 'free' && <Button variant="ghost" onClick={() => window.confirm('Cancel your plan?') && cancel.mutate({})}>Cancel plan</Button>}
      {data.payments.length > 0 && <Card><CardHeader title="Payment history" /><ul className="divide-y p-2 text-sm">{data.payments.map((p: any) => <li key={p.id} className="flex justify-between px-2 py-2"><span>{fmtDate(p.date)} · {p.planCode}</span><span>{p.amount} · {p.status}</span></li>)}</ul></Card>}
    </div>
  );
}

function DataTab() {
  const nav = useNavigate();
  const { clear } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const del = useSend('POST', '/profile/delete-account', { onSuccess: () => { clear(); nav('/login'); } });
  return (
    <div className="max-w-2xl space-y-4">
      <Card className="space-y-3 p-5"><h2 className="text-sm font-semibold">Export your data</h2><p className="text-sm text-muted-foreground">Download everything MyWallet holds about you as JSON.</p><a href="/api/v1/profile/export"><Button variant="outline">Download export</Button></a></Card>
      <Card className="space-y-3 border-expense/30 p-5"><h2 className="text-sm font-semibold text-expense">Delete account</h2><p className="text-sm text-muted-foreground">Closes your account now and permanently erases your data after a 30-day grace period.</p>
        <Input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password" /><Input placeholder='Type "DELETE" to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirmation" />
        {del.error && <ErrorBox error={del.error} />}<Button variant="danger" disabled={!pw || confirm !== 'DELETE'} loading={del.isPending} onClick={() => del.mutate({ password: pw, confirm: 'DELETE' } as any)}>Delete my account</Button></Card>
    </div>
  );
}
