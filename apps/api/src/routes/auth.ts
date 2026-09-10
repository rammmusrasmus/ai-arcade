import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from "@ai-arcade/shared";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireUser,
  resolveUser,
  roleForEmail,
  setSessionCookie,
  SESSION_COOKIE,
} from "../auth/index.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { upsertUser } from "../auth/users.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchGithubProfile,
  signState,
  verifyState,
} from "../auth/github.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { env } from "../env.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { rateLimit } from "../lib/rateLimit.js";
import { toUser } from "../serializers.js";

function safeReturnTo(raw: unknown): string {
  const fallback = env.webOrigins[0]!;
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const u = new URL(raw);
    const ok =
      env.webOrigins.includes(u.origin) ||
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1";
    return ok ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

const normEmail = (e: string) => e.trim().toLowerCase();

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/session", async (req) => {
    return { user: req.user ? toUser(req.user) : null };
  });

  app.post("/auth/logout", async (req, reply) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const token = bearer ?? cookie;
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true as const };
  });

  /* ---------------- email + password ---------------- */

  if (env.passwordAuthEnabled) {
    app.post(
      "/auth/register",
      { preHandler: rateLimit("register", 5, 15 * 60_000) },
      async (req, reply) => {
        const input = RegisterInput.parse(req.body);
        const email = normEmail(input.email);
        if (email === input.password.toLowerCase()) {
          throw badRequest("Password must not be your email address");
        }

        const existing = await db.select().from(users).where(eq(users.email, email)).get();
        if (existing) throw conflict("An account with that email already exists");

        const row = {
          id: id("user"),
          email,
          displayName: input.displayName.trim(),
          avatarUrl: null,
          passwordHash: await hashPassword(input.password),
          bio: null,
          role: roleForEmail(email),
          githubId: null,
          createdAt: Date.now(),
        };
        await db.insert(users).values(row);

        const token = await createSession(row.id, req.headers["user-agent"]);
        setSessionCookie(reply, token);
        reply.status(201);
        return { token, user: toUser(row) };
      },
    );

    app.post(
      "/auth/login",
      { preHandler: rateLimit("login", 10, 5 * 60_000) },
      async (req, reply) => {
        const input = LoginInput.parse(req.body);
        const email = normEmail(input.email);
        const user = await db.select().from(users).where(eq(users.email, email)).get();
        const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
        if (!user || !ok) {
          // Constant-ish response; don't reveal which part was wrong.
          throw unauthorized("Invalid email or password");
        }
        const token = await createSession(user.id, req.headers["user-agent"]);
        setSessionCookie(reply, token);
        return { token, user: toUser(user) };
      },
    );

    app.post("/auth/change-password", async (req) => {
      const user = requireUser(req);
      const input = ChangePasswordInput.parse(req.body);
      if (user.passwordHash) {
        const ok =
          input.currentPassword != null &&
          (await verifyPassword(input.currentPassword, user.passwordHash));
        if (!ok) throw forbidden("Current password is incorrect");
      }
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, user.id));
      return { ok: true as const };
    });
  }

  /* ---------------- profile ---------------- */

  app.patch("/me", async (req) => {
    const user = requireUser(req);
    const input = UpdateProfileInput.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName.trim();
    if (input.bio !== undefined) patch.bio = input.bio.trim() || null;
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
    if (Object.keys(patch).length === 0) return { user: toUser(user) };

    await db.update(users).set(patch).where(eq(users.id, user.id));
    const updated = await db.select().from(users).where(eq(users.id, user.id)).get();
    return { user: toUser(updated!) };
  });

  /* ---------------- dev login (local only) ---------------- */

  if (env.DEV_LOGIN_ENABLED) {
    const Body = z.object({
      email: z.string().email(),
      displayName: z.string().min(1).max(80).optional(),
    });
    app.post("/auth/dev-login", async (req, reply) => {
      if (env.isProd) throw notFound();
      const { email, displayName } = Body.parse(req.body);
      const user = await upsertUser({
        email,
        displayName: displayName ?? email.split("@")[0]!,
      });
      const token = await createSession(user.id, req.headers["user-agent"]);
      setSessionCookie(reply, token);
      return { token, user: toUser(user) };
    });
  }

  /* ---------------- GitHub OAuth ---------------- */

  if (env.githubEnabled) {
    app.get("/auth/github", async (req, reply) => {
      const returnTo = safeReturnTo((req.query as Record<string, unknown>)?.returnTo);
      const state = signState({ returnTo, nonce: Math.random().toString(36).slice(2) });
      reply.redirect(buildAuthorizeUrl(state));
    });

    app.get("/auth/github/callback", async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (q.error) throw badRequest(`GitHub returned: ${q.error_description ?? q.error}`);
      if (!q.code || !q.state) throw badRequest("Missing code/state");
      const state = verifyState(q.state);
      const accessToken = await exchangeCode(q.code);
      const profile = await fetchGithubProfile(accessToken);
      const user = await upsertUser({
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        githubId: profile.githubId,
      });
      const token = await createSession(user.id, req.headers["user-agent"]);
      setSessionCookie(reply, token);
      const returnTo = safeReturnTo(state.returnTo);
      const url = new URL(returnTo);
      url.searchParams.set("login", "ok");
      reply.redirect(url.toString());
    });
  }

  /* ---------------- capability probe for clients ---------------- */

  app.get("/auth/providers", async () => ({
    password: env.passwordAuthEnabled,
    github: env.githubEnabled,
    devLogin: env.DEV_LOGIN_ENABLED && !env.isProd,
  }));
}

export { resolveUser };
