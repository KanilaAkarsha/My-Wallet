import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { smtpMailer } from './mailer.js';

describe('smtpMailer', () => {
  it('builds a message with from/to/subject/text (JSON transport, nothing is sent)', async () => {
    const t = nodemailer.createTransport({ jsonTransport: true });
    let captured: any;
    const orig = t.sendMail.bind(t);
    (t as any).sendMail = async (m: any) => { const r: any = await orig(m); captured = JSON.parse(r.message); return r; };
    await smtpMailer(t, 'MyWallet <no-reply@x.test>').send({ to: 'a@b.co', subject: 'Verify', text: 'Hello https://x.test/verify?token=abc' });
    expect(captured.to[0].address).toBe('a@b.co');
    expect(captured.from.address).toBe('no-reply@x.test');
    expect(captured.subject).toBe('Verify');
    expect(captured.text).toContain('token=abc');
  });
});
