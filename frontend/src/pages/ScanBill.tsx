import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGet, useSend } from '@/components/ui/hooks';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Progress, Select, Textarea } from '@/components/ui/primitives';
import { parseReceiptText, type ParsedBill } from '@/lib/billParser';
import { ACCEPTED, scanFile } from '@/lib/billScan';
import { uploadFile } from '@/lib/api';
import { toInputDate } from '@/lib/utils';

interface Draft { amount: string; title: string; date: string; accountId: string; categoryId: string; notes: string }

export default function ScanBillPage() {
  const nav = useNavigate();
  const accounts = useGet<{ accounts: any[] }>(['accounts'], '/accounts');
  const cats = useGet<{ categories: any[] }>(['categories'], '/categories');
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ label: string; pct: number } | null>(null);
  const [err, setErr] = useState<string>();
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedBill>();
  const [attachment, setAttachment] = useState<File>();
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<unknown>();

  const active = (accounts.data?.accounts ?? []).filter((a) => a.status === 'active');
  const expenseCats = (cats.data?.categories ?? []).filter((c) => c.kind === 'expense');
  const create = useSend<any, Record<string, unknown>>('POST', '/transactions', { idempotent: true });

  async function onFile(file?: File) {
    if (!file) return;
    setErr(undefined); setDraft(undefined); setParsed(undefined); setRaw('');
    setBusy({ label: 'Starting', pct: 0 });
    try {
      const r = await scanFile(file, (label, pct) => setBusy({ label, pct }));
      const p = parseReceiptText(r.text);
      const hint = p.categoryHint?.toLowerCase();
      const cat = hint ? expenseCats.find((c) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase())) : undefined;
      setRaw(r.text); setParsed(p); setAttachment(r.attachment);
      setDraft({ amount: p.total ?? '', title: p.merchant ?? '', date: p.date ?? toInputDate(), accountId: active[0]?.id ?? '', categoryId: cat?.id ?? '', notes: '' });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Scan failed'); }
    finally { setBusy(null); }
  }

  const set = (k: keyof Draft, v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const valid = !!draft && /^\d{1,15}(\.\d{1,2})?$/.test(draft.amount) && Number(draft.amount) > 0 && draft.title.trim() && draft.accountId;

  async function save() {
    if (!draft || !valid) return;
    setSaving(true); setSaveErr(undefined);
    try {
      const a = active.find((x) => x.id === draft.accountId);
      const body: Record<string, unknown> = { type: 'expense', title: draft.title.trim(), amount: draft.amount, accountId: draft.accountId, currency: a?.currency, date: new Date(`${draft.date}T12:00:00+05:30`).toISOString(), status: 'posted' };
      if (draft.categoryId) body.categoryId = draft.categoryId;
      if (draft.notes) body.notes = draft.notes;
      const tx = await create.mutateAsync(body);
      // Attach the original bill. If this fails the transaction still exists — say so rather than retrying (no duplicates).
      if (attachment) {
        try { await uploadFile(attachment, { kind: 'receipt', transactionId: tx.id }); }
        catch { setSaveErr(new Error('Expense saved, but the bill image could not be attached. You can attach it from the transaction page.')); setSaving(false); return; }
      }
      nav(`/transactions/${tx.id}`);
    } catch (e) { setSaveErr(e); setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Scan bill" sub="Upload a photo or PDF. Text is read on your device; you review everything before saving." />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => camera.current?.click()} disabled={!!busy}>Take photo</Button>
          <Button variant="outline" onClick={() => picker.current?.click()} disabled={!!busy}>Upload photo or PDF</Button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo of a bill" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={picker} type="file" accept={ACCEPTED} className="sr-only" aria-label="Choose a bill photo or PDF" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        {busy && <div role="status" aria-live="polite" className="space-y-1"><p className="text-sm text-muted-foreground">{busy.label}… {Math.round(busy.pct * 100)}%</p><Progress value={busy.pct * 100} /></div>}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <p className="text-xs text-muted-foreground">Tip: flat surface, good light, whole bill in frame. First scan downloads the English text model (~10 MB) once.</p>
      </Card>

      {draft && parsed && (
        <Card className="space-y-4 p-4">
          <div className="flex items-center gap-2"><h2 className="font-medium">Review details</h2>{parsed.totalConfidence < 0.5 && <Badge tone="warn">Check the total</Badge>}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" hint={parsed.total ? undefined : 'Could not find a total — enter it'}><Input inputMode="decimal" className="num" value={draft.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
            <Field label="Merchant / title"><Input value={draft.title} onChange={(e) => set('title', e.target.value)} /></Field>
            <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="Account"><Select value={draft.accountId} onChange={(e) => set('accountId', e.target.value)}><option value="">Select account…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</Select></Field>
            <Field label="Category" hint={parsed.categoryHint ? `Suggested: ${parsed.categoryHint}` : undefined}><Select value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Uncategorised</option>{expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          </div>
          {parsed.items.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Detected items ({parsed.items.length})</summary>
              <ul className="mt-2 space-y-1">{parsed.items.map((i, n) => <li key={n} className="flex justify-between gap-3"><span>{i.name}</span><span className="num">{i.amount}</span></li>)}</ul>
              <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set('notes', parsed.items.map((i) => `${i.name} ${i.amount}`).join('\n'))}>Add items to notes</Button>
            </details>
          )}
          <Field label="Notes (optional)"><Textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value.slice(0, 1000))} /></Field>
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Raw extracted text</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{raw || '(nothing extracted)'}</pre></details>
          {saveErr != null && <ErrorBox error={saveErr} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setDraft(undefined); setParsed(undefined); }}>Discard</Button>
            <Button onClick={() => void save()} loading={saving} disabled={!valid}>Save expense</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
