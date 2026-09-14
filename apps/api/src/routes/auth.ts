import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendLoginInput,
  ResetPasswordInput,
  UpdateProfileInput,
  VerifyLoginInput,
} from "@ai-arcade/shared";
import {
  assertSignupAllowed,
  clearSessionCookie,
  createSession,
  destroySession,
  requireUser,
  resolveUser,
  roleForEmail,
  setSessionCookie,
  SESSION_COOKIE,
} from "../auth/index.js";
import {
  createLoginChallenge,
  resendLoginChallenge,
  verifyLoginChallenge,
} from "../auth/loginCode.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { requestPasswordReset, resetPassword } from "../auth/passwordReset.js";
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
import { normalizeDisplayName } from "../lib/displayName.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { checkRateLimit, rateLimit } from "../lib/rateLimit.js";
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
  //
  // Registering or logging in never issues a session by itself. Both start a
  // "challenge": a 6-digit code is emailed, and POST /auth/verify-login (the
  // code + the challenge's token) is what actually creates the session. This
  // means every sign-in — not just the first — is confirmed over email.

  if (env.passwordAuthEnabled) {
    app.post(
      "/auth/register",
      { preHandler: rateLimit("register", 5, 15 * 60_000) },
      async (req, reply) => {
        const input = RegisterInput.parse(req.body);
        const email = normEmail(input.email);
        assertSignupAllowed(email);
        if (email === input.password.toLowerCase()) {
          throw badRequest("Password must not be your email address");
        }

        const existing = await db.select().from(users).where(eq(users.email, email)).get();
        if (existing) throw conflict("An account with that email already exists");

        const displayName = input.displayName.trim();
        const displayNameNormalized = normalizeDisplayName(displayName);
        const nameTaken = await db
          .select()
          .from(users)
          .where(eq(users.displayNameNormalized, displayNameNormalized))
          .get();
        if (nameTaken) throw conflict("That display name is already taken");

        const row = {
          id: id("user"),
          email,
          displayName,
          displayNameNormalized,
          avatarUrl: null,
          passwordHash: await hashPassword(input.password),
          emailVerifiedAt: null,
          bio: null,
          role: roleForEmail(email),
          githubId: null,
          createdAt: Date.now(),
        };
        await db.insert(users).values(row);

        const challenge = await createLoginChallenge(row, req.headers["user-agent"]);
        reply.status(201);
        return { pending: true as const, email: row.email, ...challenge };
      },
    );

    app.post(
      "/auth/login",
      { preHandler: rateLimit("login", 10, 5 * 60_000) },
      async (req) => {
        const input = LoginInput.parse(req.body);
        const email = normEmail(input.email);
        const user = await db.select().from(users).where(eq(users.email, email)).get();
        const ok = user ? await verifyPassword(input.password, user.passwordHash) : false;
        if (!user || !ok) {
          // Constant-ish response; don't reveal which part was wrong.
          throw unauthorized("Invalid email or password");
        }
        const challenge = await createLoginChallenge(user, req.headers["user-agent"]);
        return { pending: true as const, email: user.email, ...challenge };
      },
    );

    app.post(
      "/auth/verify-login",
      { preHandler: rateLimit("verify-login", 30, 15 * 60_000) },
      async (req, reply) => {
        const { loginToken, code } = VerifyLoginInput.parse(req.body);
        const user = await verifyLoginChallenge(loginToken, code);
        const token = await createSession(user.id, req.headers["user-agent"]);
        setSessionCookie(reply, token);
        return { token, user: toUser(user) };
      },
    );

    app.post(
      "/auth/resend-login",
      { preHandler: rateLimit("resend-login", 10, 15 * 60_000) },
      async (req) => {
        const { loginToken } = ResendLoginInput.parse(req.body);
        const result = await resendLoginChallenge(loginToken);
        return { ok: true as const, ...result };
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

    app.post(
      "/auth/forgot-password",
      { preHandler: rateLimit("forgot-password", 5, 15 * 60_000) },
      async (req) => {
        const { email } = ForgotPasswordInput.parse(req.body);
        const normalized = normEmail(email);
        // Also cap by the target email itself so one victim can't be spammed
        // from many different IPs.
        checkRateLimit(`forgot-password-email:${normalized}`, 5, 60 * 60_000);
        // Same response whether or not the account exists — no enumeration.
        const result = await requestPasswordReset(normalized, req.headers["user-agent"]);
        return { ok: true as const, ...result };
      },
    );

    app.post(
      "/auth/reset-password",
      { preHandler: rateLimit("reset-password", 20, 15 * 60_000) },
      async (req) => {
        const { resetToken, code, newPassword } = ResetPasswordInput.parse(req.body);
        await resetPassword(resetToken, code, newPassword);
        return { ok: true as const };
      },
    );
  }

  /* ---------------- profile ---------------- */

  app.patch("/me", async (req) => {
    const user = requireUser(req);
    const input = UpdateProfileInput.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      const displayNameNormalized = normalizeDisplayName(displayName);
      if (displayNameNormalized !== normalizeDisplayName(user.displayName)) {
        const taken = await db
          .select()
          .from(users)
          .where(eq(users.displayNameNormalized, displayNameNormalized))
          .get();
        if (taken) throw conflict("That display name is already taken");
      }
      patch.displayName = displayName;
      patch.displayNameNormalized = displayNameNormalized;
    }
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
    // If false, sign-in codes are printed to the server console instead of
    // emailed — true local-dev-only fallback, never the case in production.
    emailDeliveryConfigured: env.smtpConfigured,
  }));
}

export { resolveUser };
