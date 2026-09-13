import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type UserRow } from "../db/schema.js";
import { normalizeDisplayName } from "../lib/displayName.js";
import { id } from "../lib/ids.js";
import { assertSignupAllowed, roleForEmail } from "./index.js";

/**
 * Finds a free display name starting from `base`, appending "2", "3", ...
 * when it's taken. Used for OAuth/dev-login, which have no interactive step
 * to ask the person for a different name up front — they can rename later.
 */
async function uniqueDisplayName(base: string): Promise<{ displayName: string; displayNameNormalized: string }> {
  let candidate = base;
  for (let n = 2; n <= 50; n++) {
    const normalized = normalizeDisplayName(candidate);
    const taken = await db.select().from(users).where(eq(users.displayNameNormalized, normalized)).get();
    if (!taken) return { displayName: candidate, displayNameNormalized: normalized };
    candidate = `${base}${n}`;
  }
  const normalized = normalizeDisplayName(candidate);
  return { displayName: candidate, displayNameNormalized: normalized };
}

export interface UpsertUserInput {
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  githubId?: string | null;
}

export async function upsertUser(input: UpsertUserInput): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();

  const existing =
    (input.githubId
      ? await db.select().from(users).where(eq(users.githubId, input.githubId)).get()
      : undefined) ?? (await db.select().from(users).where(eq(users.email, email)).get());

  if (existing) {
    const role = roleForEmail(email, existing.role);
    const patch: Partial<UserRow> = {};
    if (input.avatarUrl !== undefined && input.avatarUrl !== existing.avatarUrl) {
      patch.avatarUrl = input.avatarUrl;
    }
    if (input.githubId && input.githubId !== existing.githubId) patch.githubId = input.githubId;
    if (role !== existing.role) patch.role = role;
    if (!existing.displayName && input.displayName) {
      const unique = await uniqueDisplayName(input.displayName);
      patch.displayName = unique.displayName;
      patch.displayNameNormalized = unique.displayNameNormalized;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, existing.id));
      return { ...existing, ...patch };
    }
    return existing;
  }

  assertSignupAllowed(email);
  const now = Date.now();
  const unique = await uniqueDisplayName(input.displayName || email.split("@")[0]!);
  const row: UserRow = {
    id: id("user"),
    email,
    displayName: unique.displayName,
    displayNameNormalized: unique.displayNameNormalized,
    avatarUrl: input.avatarUrl ?? null,
    passwordHash: null,
    // Reached via GitHub OAuth or the local dev-login bypass — both already
    // represent an authenticated identity, so there's no separate code to confirm.
    emailVerifiedAt: now,
    bio: null,
    role: roleForEmail(email),
    githubId: input.githubId ?? null,
    createdAt: now,
  };
  await db.insert(users).values(row);
  return row;
}
