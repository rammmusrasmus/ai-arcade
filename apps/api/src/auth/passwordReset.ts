import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { passwordResets, users } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";
import { id, sessionToken } from "../lib/ids.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { destroyAllUserSessions } from "./index.js";
import { hashPassword } from "./password.js";

const RESET_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Start a password reset. Always returns a reset token, whether or not the email
 * belongs to a password account — for an unknown email the token simply matches
 * nothing — so the response never reveals which addresses have accounts.
 */
export async function requestPasswordReset(
  email: string,
  userAgent?: string,
): Promise<{ resetToken: string; expiresInSeconds: number }> {
  const resetToken = sessionToken();
  const result = { resetToken, expiresInSeconds: RESET_TTL_MS / 1000 };

  // Accounts without a password (seeded, dev-login, GitHub) can use this to set one:
  // entering the emailed code proves ownership of the address either way.
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  if (!user) return result;

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const now = Date.now();
  await db.insert(passwordResets).values({
    id: id("pwreset"),
    userId: user.id,
    tokenHash: hash(resetToken),
    codeHash: hash(code),
    attempts: 0,
    expiresAt: now + RESET_TTL_MS,
    userAgent: userAgent?.slice(0, 400) ?? null,
    createdAt: now,
  });

  // Not awaited: the SMTP round-trip would make known emails respond measurably slower.
  sendPasswordResetEmail(user.email, code, RESET_TTL_MS / 60_000).catch((err) =>
    console.error("[password-reset] email send failed:", err instanceof Error ? err.message : err),
  );
  return result;
}

/**
 * Checks the emailed code, sets the new password, and signs out every session.
 * Every failure (unknown token, wrong code, expired, used, too many tries) gives
 * the same message, so it can't be used to probe for accounts.
 */
export async function resetPassword(resetToken: string, code: string, newPassword: string): Promise<void> {
  const invalid = () => badRequest("That code is invalid or has expired. Request a new one.");

  const row = await db
    .select()
    .from(passwordResets)
    .where(eq(passwordResets.tokenHash, hash(resetToken)))
    .get();
  if (!row || !row.codeHash) throw invalid();

  const now = Date.now();
  if (row.consumedAt || row.expiresAt < now || row.attempts >= MAX_ATTEMPTS) throw invalid();

  const given = hash(code.trim());
  const ok =
    given.length === row.codeHash.length && timingSafeEqual(Buffer.from(given), Buffer.from(row.codeHash));
  if (!ok) {
    await db
      .update(passwordResets)
      .set({ attempts: row.attempts + 1 })
      .where(eq(passwordResets.id, row.id));
    throw invalid();
  }

  await db.update(passwordResets).set({ consumedAt: now }).where(eq(passwordResets.id, row.id));
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.userId));
  await destroyAllUserSessions(row.userId);
}
