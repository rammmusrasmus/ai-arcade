import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { sessions, users, type UserRow } from "../db/schema.js";
import { env } from "../env.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { id, sessionToken } from "../lib/ids.js";

export const SESSION_COOKIE = "aa_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROLE_RANK: Record<UserRow["role"], number> = { user: 0, moderator: 1, admin: 2 };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = sessionToken();
  await db.insert(sessions).values({
    id: id("sess"),
    userId,
    tokenHash: hashToken(token),
    userAgent: userAgent?.slice(0, 400) ?? null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

function tokenFromRequest(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  return cookies?.[SESSION_COOKIE] ?? null;
}

/** Look up the user for a raw session token (used outside the HTTP request cycle, e.g. WebSocket). */
export async function resolveUserByToken(token: string): Promise<UserRow | null> {
  if (!token) return null;
  const row = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get();
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    return null;
  }
  return row.user;
}

export async function resolveUser(req: FastifyRequest): Promise<UserRow | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  return resolveUserByToken(token);
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/* -------- guards -------- */

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, min: UserRow["role"]): UserRow {
  const user = requireUser(req);
  if (ROLE_RANK[user.role] < ROLE_RANK[min]) {
    throw forbidden(`Requires ${min} role`);
  }
  return user;
}

/** Resolve the role a user should have on login, honoring ADMIN_EMAILS. */
export function roleForEmail(email: string, current?: UserRow["role"]): UserRow["role"] {
  if (env.adminEmails.has(email.toLowerCase())) return "admin";
  return current ?? "user";
}
