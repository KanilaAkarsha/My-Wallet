import { zodResolver } from '@hookform/resolvers/zod';
import { Wallet } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, ErrorBox, Field, Input } from '@/components/ui/primitives';
import { ApiError, get, post, setCsrf } from '@/lib/api';
import { useAuth } from '@/store/auth';

function Shell({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-brand text-brand-foreground"><Wallet className="h-5 w-5" /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{sub ?? 'Own Your Money. Build Your Future.'}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_not_configured: 'Google sign-in is not set up on this server.',
  google_two_factor: 'This account has two-factor authentication on. Sign in with your password and authenticator code instead.',
  google_suspended: 'This account is unavailable.',
};

function GoogleButton() {
  const [params] = useSearchParams();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { get<{ google: boolean }>('/auth/providers').then((r) => setEnabled(!!r.google)).catch(() => setEnabled(false)); }, []);
  const msg = GOOGLE_ERRORS[params.get('error') ?? ''];
  return (
    <>
      {msg && <p role="alert" className="mb-3 rounded-md border border-expense/30 bg-expense/5 p-3 text-sm text-expense">{msg}</p>}
      {enabled && (
        <>
          {/* Full-page navigation: the browser must follow the redirect to Google and back. */}
          <a href="/api/v1/auth/google" className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border bg-card text-sm font-medium hover:bg-muted">
            <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" /><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
            Continue with Google
          </a>
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        </>
      )}
    </>
  );
}

/** Landing page after Google redirects back: collect the one-time CSRF token, then enter the app. */
export function GoogleDonePage() {
  const nav = useNavigate();
  const load = useAuth((s) => s.load);
  useEffect(() => {
    get<{ csrfToken: string }>('/auth/csrf')
      .then(async (r) => { setCsrf(r.csrfToken); await load(); nav('/dashboard', { replace: true }); })
      .catch(() => nav('/login?error=google_failed', { replace: true }));
  }, [load, nav]);
  return <Shell title="Signing you in…"><p className="text-center text-sm text-muted-foreground">One moment.</p></Shell>;
}

export const passwordRule = z.string().min(12, 'Use at least 12 characters').max(128);
const loginSchema = z.object({ email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Enter your password'), totp: z.string().optional() });

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [need2fa, setNeed2fa] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const f = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try {
      await login({ email: v.email, password: v.password, ...(v.totp ? (v.totp.length > 6 ? { recoveryCode: v.totp } : { totp: v.totp }) : {}) });
      nav('/dashboard', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && /two-factor|2fa|code/i.test(e.message) && e.status === 401) setNeed2fa(true);
      setErr(e);
    }
  });
  return (
    <Shell title="Welcome back">
      <GoogleButton />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={f.formState.errors.email?.message}><Input type="email" autoComplete="email" {...f.register('email')} /></Field>
        <Field label="Password" error={f.formState.errors.password?.message}><Input type="password" autoComplete="current-password" {...f.register('password')} /></Field>
        {need2fa && <Field label="Authenticator code or recovery code"><Input inputMode="numeric" autoComplete="one-time-code" {...f.register('totp')} /></Field>}
        {err ? <ErrorBox error={err} /> : null}
        <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Sign in</Button>
        <div className="flex justify-between text-sm"><Link className="text-brand" to="/forgot-password">Forgot password?</Link><Link className="text-brand" to="/register">Create account</Link></div>
      </form>
    </Shell>
  );
}

const regSchema = z.object({ email: z.string().email('Enter a valid email'), displayName: z.string().trim().min(1, 'Enter your name').max(60), password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
export function RegisterPage() {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const f = useForm<z.infer<typeof regSchema>>({ resolver: zodResolver(regSchema) });
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try { await post('/auth/register', { email: v.email, password: v.password, displayName: v.displayName }); setDone(true); } catch (e) { setErr(e); }
  });
  if (done) return <Shell title="Check your email" sub="If this email can be registered, we sent a verification link."><Link className="text-sm text-brand" to="/login">Back to sign in</Link></Shell>;
  return (
    <Shell title="Create your account" sub="Free to start. No card required.">
      <GoogleButton />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" error={f.formState.errors.displayName?.message}><Input autoComplete="name" {...f.register('displayName')} /></Field>
        <Field label="Email" error={f.formState.errors.email?.message}><Input type="email" autoComplete="email" {...f.register('email')} /></Field>
        <Field label="Password" hint="At least 12 characters" error={f.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...f.register('password')} /></Field>
        <Field label="Confirm password" error={f.formState.errors.confirm?.message}><Input type="password" autoComplete="new-password" {...f.register('confirm')} /></Field>
        {err ? <ErrorBox error={err} /> : null}
        <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Create account</Button>
        <p className="text-center text-sm">Already registered? <Link className="text-brand" to="/login">Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPage() {
  const [sent, setSent] = useState(false);
  const f = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid email') })) });
  const submit = f.handleSubmit(async (v) => { try { await post('/auth/forgot-password', v); } finally { setSent(true); } });
  return (
    <Shell title="Reset password" sub={sent ? 'If an account exists for that email, a reset link is on its way.' : 'We’ll email you a reset link.'}>
      {sent ? <Link className="text-sm text-brand" to="/login">Back to sign in</Link> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" error={f.formState.errors.email?.message}><Input type="email" {...f.register('email')} /></Field>
          <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Send reset link</Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  const f = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(z.object({ password: passwordRule, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })) });
  const submit = f.handleSubmit(async (v) => { try { await post('/auth/reset-password', { token: sp.get('token') ?? '', newPassword: v.password }); nav('/login'); } catch (e) { setErr(e); } });
  return (
    <Shell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="New password" error={f.formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...f.register('password')} /></Field>
        <Field label="Confirm" error={f.formState.errors.confirm?.message}><Input type="password" autoComplete="new-password" {...f.register('confirm')} /></Field>
        {err ? <ErrorBox error={err} /> : null}
        <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>Update password</Button>
      </form>
    </Shell>
  );
}

export function VerifyPage() {
  const [sp] = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'bad'>('working');
  useEffect(() => { post('/auth/verify-email', { token: sp.get('token') ?? '' }).then(() => setState('ok')).catch(() => setState('bad')); }, [sp]);
  return (
    <Shell title={state === 'working' ? 'Verifying…' : state === 'ok' ? 'Email verified' : 'Link invalid or expired'}>
      <Link className="text-sm text-brand" to="/login">Continue to sign in</Link>
    </Shell>
  );
}
