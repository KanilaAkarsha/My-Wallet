import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

/**
 * Mail transport. When SMTP_URL is set (e.g. smtps://user:pass@smtp.example.com:465) mail goes out over SMTP.
 * Delivery is NOT verified against a real provider in this repo's tests (only against nodemailer's JSON transport).
 * Without SMTP_URL:
 *  - development/test: the link is logged so flows can be exercised locally;
 *  - production: nothing is sent and a warning is logged (tokens are never logged in production).
 */
export interface Mailer {
  send(msg: { to: string; subject: string; text: string; devLink?: string }): Promise<void>;
}

export const defaultMailer: Mailer = {
  async send({ to, subject, devLink }) {
    if (env().isProd) {
      logger.warn({ subject }, 'email not sent: no mail transport configured');
      return;
    }
    logger.info({ to, subject, devLink }, 'DEV email (not sent)');
  },
};

/** Builds an SMTP mailer. `transport` is injectable so tests can use nodemailer's in-memory JSON transport. */
export function smtpMailer(transport: Transporter, from: string): Mailer {
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

let current: Mailer | undefined;
export const getMailer = (): Mailer => {
  if (current) return current;
  const url = env().SMTP_URL;
  current = url ? smtpMailer(nodemailer.createTransport(url), env().EMAIL_FROM) : defaultMailer;
  return current;
};
/** Test seam: lets integration tests capture verification/reset links. */
export const setMailer = (m: Mailer): void => {
  current = m;
};
