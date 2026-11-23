import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSend } from '@/components/ui/hooks';
import { Button, Card, ErrorBox, Field, Input, Select } from '@/components/ui/primitives';

const GOALS = ['Save more', 'Pay off debt', 'Track spending', 'Build emergency fund', 'Plan a big purchase'];

export default function Onboarding() {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [occupation, setOccupation] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [acctName, setAcctName] = useState('Cash');
  const [bal, setBal] = useState('0');
  const save = useSend('POST', '/profile/onboarding', { idempotent: true, onSuccess: () => nav('/dashboard', { replace: true }) });
  const finish = (skip: boolean) => save.mutate(skip ? {} as any : { displayName: name || undefined, occupation: occupation || null, goals, accounts: acctName ? [{ name: acctName, type: 'cash', startingBalance: bal || '0' }] : [] } as any);
  const balOk = /^-?\d{1,15}(\.\d{1,2})?$/.test(bal);
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <Card className="w-full max-w-md space-y-5 p-6">
        <div className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand' : 'bg-muted'}`} />)}</div>
        {step === 0 && <><h1 className="text-xl font-semibold">Welcome to MyWallet</h1><p className="text-sm text-muted-foreground">Everything here is optional — skip any step.</p>
          <Field label="What should we call you?"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="I am a…"><Select value={occupation} onChange={(e) => setOccupation(e.target.value)}><option value="">Prefer not to say</option><option value="student">Student</option><option value="employed">Employed</option><option value="freelancer">Freelancer</option><option value="other">Other</option></Select></Field></>}
        {step === 1 && <><h1 className="text-xl font-semibold">What are your goals?</h1><div className="flex flex-wrap gap-2">{GOALS.map((g) => <button key={g} type="button" aria-pressed={goals.includes(g)} onClick={() => setGoals((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))} className={`rounded-full border px-3 py-2 text-sm ${goals.includes(g) ? 'border-brand bg-brand-soft text-brand' : ''}`}>{g}</button>)}</div></>}
        {step === 2 && <><h1 className="text-xl font-semibold">Add your first account</h1><Field label="Account name"><Input value={acctName} onChange={(e) => setAcctName(e.target.value)} /></Field><Field label="Current balance (LKR)" error={balOk ? undefined : 'Enter a number'}><Input inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} /></Field></>}
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => finish(true)} loading={save.isPending && step < 0}>Skip setup</Button>
          <div className="flex gap-2">{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}{step < 2 ? <Button onClick={() => setStep(step + 1)}>Next</Button> : <Button onClick={() => finish(false)} disabled={!balOk} loading={save.isPending}>Finish</Button>}</div>
        </div>
      </Card>
    </div>
  );
}
