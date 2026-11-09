import nodemailer from 'nodemailer';
import type { SendLoginCode } from './email-auth';

/** Return no sender until SMTP is explicitly configured. Never log codes or credentials. */
export function createMailer(env: NodeJS.ProcessEnv): SendLoginCode | undefined {
  const { DAGGERY_SMTP_HOST: host, DAGGERY_SMTP_USER: user, DAGGERY_SMTP_PASSWORD: pass, DAGGERY_SMTP_FROM: from } = env;
  if (!host || !user || !pass || !from) return undefined;
  const port = Number(env.DAGGERY_SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port');
  const secure = port === 465;
  const transport = nodemailer.createTransport({ host, port, secure, requireTLS: !secure, auth: { user, pass } });
  return async (email, code) => {
    await transport.sendMail({
      from, to: email, subject: 'Seu código de acesso ao Daggery',
      text: `Seu código de acesso é ${code}. Ele é válido por 10 minutos e pode ser usado apenas uma vez.\n\nSe você não solicitou este código, ignore esta mensagem.`,
    });
  };
}
