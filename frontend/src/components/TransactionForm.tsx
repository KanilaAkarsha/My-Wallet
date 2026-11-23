import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from '@/components/ui/primitives';
import { useGet, useSend } from '@/components/ui/hooks';
import { toInputDate } from '@/lib/utils';
import { useUI } from '@/store/ui';

const schema = z.object({
  type: z.enum(['expense', 'income', 'refund', 'adjustment']),
  direction: z.enum(['in', 'out']).optional(),
  title: z.string().trim().min(1, 'Add a title').max(120),
  amount: z.string().trim().regex(/^\d{1,15}(\.\d{1,2})?$/, 'Enter a positive amount, e.g. 1250.50').refine((v) => Number(v) > 0, 'Must be greater than zero'),
  accountId: z.string().min(1, 'Choose an account'),
  categoryId: z.string().optional(),
  date: z.string().min(1),
  notes: z.string().max(1000).optional(),
});
type Form = z.infer<typeof schema>;

export function TransactionForm({ open, onOpenChange, defaultType = 'expense' }: { open: boolean; onOpenChange: (o: boolean) => void; defaultType?: Form['type'] }) {
  const nav = useNavigate();
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const cats = useGet<{ categories: any[] }>(['categories'], '/categories');
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { type: defaultType, date: toInputDate(), title: '', amount: '' } });
  const { register, handleSubmit, watch, reset, formState: { errors } } = form;
  const type = watch('type');
  const save = useSend<any, Form>('POST', '/transactions', { idempotent: true, onSuccess: () => { reset({ type: defaultType, date: toInputDate(), title: '', amount: '' }); onOpenChange(false); } });
  const active = (accounts.data?.accounts ?? []).filter((a) => a.status === 'active');
  const kind = type === 'income' ? 'income' : 'expense';
  const options = (cats.data?.categories ?? []).filter((c) => c.kind === kind);

  const submit = handleSubmit((v) => {
    const a = active.find((x) => x.id === v.accountId);
    const body: Record<string, unknown> = { type: v.type, title: v.title, amount: v.amount, accountId: v.accountId, currency: a?.currency, date: new Date(`${v.date}T12:00:00+05:30`).toISOString(), status: 'posted' };
    if (v.categoryId) body.categoryId = v.categoryId;
    if (v.notes) body.notes = v.notes;
    if (v.type === 'adjustment') body.direction = v.direction ?? 'in';
    save.mutate(body as any);
  });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add transaction">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1" role="radiogroup" aria-label="Type">
          {(['expense', 'income', 'refund', 'adjustment'] as const).map((t) => (
            <label key={t} className={`cursor-pointer rounded-sm py-2 text-center text-xs font-medium capitalize ${type === t ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              <input type="radio" value={t} className="sr-only" {...register('type')} />{t}
            </label>
          ))}
        </div>
        {type === 'expense' && <Button type="button" variant="outline" className="w-full" onClick={() => { onOpenChange(false); nav('/scan'); }}>Scan a bill (photo or PDF)</Button>}
        <Field label="Amount" error={errors.amount?.message}><Input inputMode="decimal" autoFocus placeholder="0.00" className="num text-lg" {...register('amount')} /></Field>
        <Field label="Title" error={errors.title?.message}><Input placeholder="e.g. Lunch" {...register('title')} /></Field>
        <Field label="Account" error={errors.accountId?.message}>
          <Select {...register('accountId')}><option value="">Select account…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</Select>
        </Field>
        {type === 'adjustment' && <Field label="Direction"><Select {...register('direction')}><option value="in">Increase balance</option><option value="out">Decrease balance</option></Select></Field>}
        {type !== 'adjustment' && <Field label="Category"><Select {...register('categoryId')}><option value="">Uncategorised</option>{options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        <Field label="Date" error={errors.date?.message}><Input type="date" {...register('date')} /></Field>
        <Field label="Notes (optional)"><Textarea rows={2} {...register('notes')} /></Field>
        {save.error && <ErrorBox error={save.error} />}
        {!active.length && !accounts.isLoading && <p className="text-sm text-warn">Create an account first (Accounts → Add account).</p>}
        <Button type="submit" className="w-full" loading={save.isPending}>Save transaction</Button>
      </form>
    </Modal>
  );
}

export const QuickAddHost = () => {
  const { quickAdd, setQuickAdd } = useUI();
  return <TransactionForm open={quickAdd} onOpenChange={setQuickAdd} />;
};
