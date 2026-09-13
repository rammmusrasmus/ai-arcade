import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { badRequest } from "../lib/errors.js";

export interface GithubProfile {
  githubId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

/* ---- signed state (CSRF + returnTo carrier) ---- */

export function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", env.AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(raw: string, maxAgeMs = 10 * 60 * 1000): Record<string, unknown> {
  const [body, sig] = raw.split(".");
  if (!body || !sig) throw badRequest("Malformed OAuth state");
  const expected = createHmac("sha256", env.AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw badRequest("Bad OAuth state signature");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  if (typeof parsed.t !== "number" || Date.now() - parsed.t > maxAgeMs) {
    throw badRequest("OAuth state expired");
  }
  return parsed;
}

/* ---- OAuth flow ---- */

export function buildAuthorizeUrl(state: string): string {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", `${env.PUBLIC_API_URL}/auth/github/callback`);
  u.searchParams.set("scope", "read:user user:email");
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.PUBLIC_API_URL}/auth/github/callback`,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) {
    throw badRequest(json.error_description ?? "GitHub token exchange failed");
  }
  return json.access_token;
}

export async function fetchGithubProfile(accessToken: string): Promise<GithubProfile> {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "user-agent": "ai-arcade",
  };
  const [userRes, emailRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userRes.ok) throw badRequest("Failed to load GitHub profile");

  const gh = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
  };

  let email = `${gh.login}@users.noreply.github.com`;
  if (emailRes.ok) {
    const emails = (await emailRes.json()) as {
      email: string;
      primary: boolean;
      verified: boolean;
    }[];
    // Accounts are matched by email, so an unverified address would let someone sign in
    // as whoever owns it (including an ADMIN_EMAILS account). Verified only.
    const best =
      emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (best?.email) email = best.email;
  }

  return {
    githubId: String(gh.id),
    email,
    displayName: gh.name?.trim() || gh.login,
    avatarUrl: gh.avatar_url,
  };
}
