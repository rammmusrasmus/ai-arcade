import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { passwordResets, users } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { id, sessionToken } from "../lib/ids.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { env } from "../env.js";
import { destroyAllUserSessions } from "./index.js";
import { hashPassword } from "./password.js";

const RESET_TTL_MS = 30 * 60_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Start a password reset. Always resolves without revealing whether the email
 * is registered (or has a password to reset) — the caller should return the
 * same generic response either way.
 */
export async function requestPasswordReset(email: string, userAgent?: string): Promise<void> {
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user || !user.passwordHash) return;

  const token = sessionToken();
  const now = Date.now();
  await db.insert(passwordResets).values({
    id: id("pwreset"),
    userId: user.id,
    tokenHash: hash(token),
    expiresAt: now + RESET_TTL_MS,
    userAgent: userAgent?.slice(0, 400) ?? null,
    createdAt: now,
  });

  const resetUrl = `${env.webOrigins[0]}/reset-password?token=${encodeURIComponent(token)}`;
  await sendPasswordResetEmail(user.email, resetUrl, RESET_TTL_MS / 60_000);
}

/** Consumes a reset token, sets the new password, and signs out every existing session. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const row = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hash(token)))
    .get();
  if (!row) throw notFound("That reset link is invalid or has expired.");

  const now = Date.now();
  if (row.consumedAt) throw badRequest("That reset link was already used.");
  if (row.expiresAt < now) throw badRequest("That reset link has expired.");

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.userId));
  await db.update(passwordResets).set({ consumedAt: now }).where(eq(passwordResets.id, row.id));
  await destroyAllUserSessions(row.userId);
}
