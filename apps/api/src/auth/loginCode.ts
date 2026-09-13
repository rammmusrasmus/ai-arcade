import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { authChallenges, users, type AuthChallengeRow, type UserRow } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { id, sessionToken } from "../lib/ids.js";
import { sendLoginCodeEmail } from "../lib/mailer.js";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_COOLDOWN_MS = 30_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

function makeCode(): string {
  // crypto.randomInt is rejection-sampled — uniform, not biased like `% 10`.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Start a login challenge: the caller has already verified the password (or is
 * a fresh registration). Emails a 6-digit code and returns the opaque token the
 * client must send back with it. Neither the token nor the code is ever stored
 * in plain text — only their SHA-256 hashes.
 */
export async function createLoginChallenge(
  user: UserRow,
  userAgent?: string,
): Promise<{ loginToken: string; expiresInSeconds: number }> {
  const loginToken = sessionToken();
  const code = makeCode();
  const now = Date.now();

  await db.insert(authChallenges).values({
    id: id("chal"),
    userId: user.id,
    purpose: "login",
    tokenHash: hash(loginToken),
    codeHash: hash(code),
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    resends: 0,
    maxResends: MAX_RESENDS,
    lastSentAt: now,
    expiresAt: now + CODE_TTL_MS,
    userAgent: userAgent?.slice(0, 400) ?? null,
    createdAt: now,
  });

  await sendLoginCodeEmail(user.email, code, CODE_TTL_MS / 60_000);
  return { loginToken, expiresInSeconds: CODE_TTL_MS / 1000 };
}

async function loadChallenge(loginToken: string): Promise<AuthChallengeRow> {
  const row = await db
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.tokenHash, hash(loginToken)))
    .get();
  if (!row) throw notFound("That login code has expired — sign in again.");
  return row;
}

/** Verify the 6-digit code. Throws on any failure; returns the user on success. */
export async function verifyLoginChallenge(
  loginToken: string,
  code: string,
): Promise<UserRow> {
  const row = await loadChallenge(loginToken);
  const now = Date.now();

  if (row.consumedAt) throw badRequest("That code was already used. Sign in again for a new one.");
  if (row.expiresAt < now) throw badRequest("That code expired. Sign in again for a new one.");
  if (row.attempts >= row.maxAttempts) {
    throw forbidden("Too many wrong attempts. Sign in again for a new code.");
  }

  const given = hash(code.trim());
  const ok =
    given.length === row.codeHash.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(row.codeHash));

  if (!ok) {
    await db
      .update(authChallenges)
      .set({ attempts: row.attempts + 1 })
      .where(eq(authChallenges.id, row.id));
    const left = row.maxAttempts - row.attempts - 1;
    throw badRequest(left > 0 ? `Wrong code. ${left} attempt(s) left.` : "Wrong code.");
  }

  await db.update(authChallenges).set({ consumedAt: now }).where(eq(authChallenges.id, row.id));

  const user = await db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) throw notFound("Account no longer exists");

  if (!user.emailVerifiedAt) {
    await db.update(users).set({ emailVerifiedAt: now }).where(eq(users.id, user.id));
    user.emailVerifiedAt = now;
  }
  return user;
}

/** Send a fresh code for an existing, still-valid challenge. Rate-limited. */
export async function resendLoginChallenge(
  loginToken: string,
): Promise<{ expiresInSeconds: number }> {
  const row = await loadChallenge(loginToken);
  const now = Date.now();

  if (row.consumedAt) throw badRequest("That code was already used. Sign in again.");
  if (row.expiresAt < now) throw badRequest("That login attempt expired. Sign in again.");
  if (row.resends >= row.maxResends) throw forbidden("No more resends for this attempt — sign in again.");
  if (now - row.lastSentAt < RESEND_COOLDOWN_MS) {
    throw forbidden(`Please wait a few seconds before requesting another code.`);
  }

  const user = await db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) throw notFound("Account no longer exists");

  const code = makeCode();
  await db
    .update(authChallenges)
    .set({
      codeHash: hash(code),
      resends: row.resends + 1,
      lastSentAt: now,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    })
    .where(eq(authChallenges.id, row.id));

  await sendLoginCodeEmail(user.email, code, CODE_TTL_MS / 60_000);
  return { expiresInSeconds: CODE_TTL_MS / 1000 };
}
