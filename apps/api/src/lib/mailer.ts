import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtpConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true for port 465, false for 587/STARTTLS
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email. With no SMTP_HOST configured (local dev), this logs the
 * message to the server console instead — nothing is silently dropped, and
 * the login-code flow stays testable without a mail provider.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const t = getTransporter();
  if (!t) {
    console.log(
      `\n[mailer] SMTP not configured — printing instead of sending:\n` +
        `  to:      ${mail.to}\n` +
        `  subject: ${mail.subject}\n` +
        `  ${mail.text.split("\n").join("\n  ")}\n`,
    );
    return;
  }
  await t.sendMail({ from: env.SMTP_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

export async function sendLoginCodeEmail(to: string, code: string, minutes: number): Promise<void> {
  const text =
    `Your AI Arcade sign-in code is: ${code}\n\n` +
    `It expires in ${minutes} minutes. If you didn't try to sign in, you can ignore this email.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:420px">
      <p>Your AI Arcade sign-in code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
      <p style="color:#666;font-size:13px">Expires in ${minutes} minutes. If you didn't try to sign in, you can ignore this email.</p>
    </div>`;
  await sendMail({ to, subject: "Your AI Arcade sign-in code", text, html });
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  minutes: number,
): Promise<void> {
  const text =
    `Someone (hopefully you) asked to reset the password on your AI Arcade account.\n\n` +
    `Reset it here: ${resetUrl}\n\n` +
    `This link expires in ${minutes} minutes and can only be used once. ` +
    `If you didn't request this, you can ignore this email — your password won't change.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:420px">
      <p>Someone (hopefully you) asked to reset the password on your AI Arcade account.</p>
      <p><a href="${resetUrl}" style="color:#7ab8ff">Reset your password</a></p>
      <p style="color:#666;font-size:13px">This link expires in ${minutes} minutes and can only be used once. If you didn't request this, you can ignore this email — your password won't change.</p>
    </div>`;
  await sendMail({ to, subject: "Reset your AI Arcade password", text, html });
}
