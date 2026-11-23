import * as Dialog from '@radix-ui/react-dialog';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn, fmtMoney, isNeg } from '@/lib/utils';
import { useUI } from '@/store/ui';

const button = cva('inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none min-h-10 px-4', {
  variants: {
    variant: {
      primary: 'bg-brand text-brand-foreground hover:opacity-90',
      outline: 'border bg-card hover:bg-muted',
      ghost: 'hover:bg-muted',
      danger: 'bg-expense text-white hover:opacity-90',
    },
    size: { md: '', sm: 'min-h-8 px-3 text-xs', icon: 'min-h-10 w-10 px-0' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> { loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} disabled={disabled || loading} {...p}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

const field = 'w-full rounded-md border bg-card px-3 min-h-10 text-sm placeholder:text-muted-foreground focus-visible:outline-brand disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, className)} {...p} />);
Input.displayName = 'Input';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, className)} {...p} />);
Select.displayName = 'Select';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'py-2', className)} {...p} />);
Textarea.displayName = 'Textarea';

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-expense">{error}</span>}
    </label>
  );
}

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...p} />;
export const CardHeader = ({ title, action }: { title: ReactNode; action?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-5"><h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>{action}</div>
);

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'bad' | 'warn'; children: ReactNode }) {
  const t = { neutral: 'bg-muted text-muted-foreground', good: 'bg-brand-soft text-brand', bad: 'bg-expense/10 text-expense', warn: 'bg-warn/10 text-warn' }[tone];
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function Progress({ value, tone }: { value: number; tone?: 'good' | 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(100, value));
  const c = tone === 'bad' ? 'bg-expense' : tone === 'warn' ? 'bg-warn' : 'bg-brand';
  return <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}><div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${v}%` }} /></div>;
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-muted', className)} />;

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-expense/30 bg-expense/5 p-3 text-sm">
      <p className="text-expense">{(error as Error)?.message ?? 'Something went wrong'}</p>
      {retry && <Button size="sm" variant="outline" className="mt-2" onClick={retry}>Try again</Button>}
    </div>
  );
}

/** Money display: tabular numerals, honours the balance-hide toggle, colours by sign when `tone` is set. */
export function Money({ value, currency = 'LKR', tone, sign, className, sensitive = true }: { value?: unknown; currency?: string; tone?: 'auto' | 'income' | 'expense'; sign?: boolean; className?: string; sensitive?: boolean }) {
  const hide = useUI((s) => s.hideBalances) && sensitive;
  const c = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : tone === 'auto' ? (isNeg(value) ? 'text-expense' : '') : '';
  return <span className={cn('num', c, className)}>{fmtMoney(value, currency, { hidden: hide, sign })}</span>;
}

export function Modal({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content aria-describedby={undefined} className="fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-y-auto bg-card p-5 shadow-xl max-sm:inset-0 max-sm:max-h-none max-sm:rounded-none sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="rounded-md p-2 hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <SwitchPrimitive.Root checked={checked} onCheckedChange={onChange} aria-label={label} className="relative h-6 w-11 shrink-0 rounded-full bg-muted data-[state=checked]:bg-brand">
      <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitive.Root>
  );
}

export const PageHeader = ({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>{sub && <p className="text-sm text-muted-foreground">{sub}</p>}</div>
    {action}
  </div>
);
