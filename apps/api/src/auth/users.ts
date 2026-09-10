import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type UserRow } from "../db/schema.js";
import { id } from "../lib/ids.js";
import { roleForEmail } from "./index.js";

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
    if (!existing.displayName && input.displayName) patch.displayName = input.displayName;
    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, existing.id));
      return { ...existing, ...patch };
    }
    return existing;
  }

  const row: UserRow = {
    id: id("user"),
    email,
    displayName: input.displayName || email.split("@")[0]!,
    avatarUrl: input.avatarUrl ?? null,
    passwordHash: null,
    bio: null,
    role: roleForEmail(email),
    githubId: input.githubId ?? null,
    createdAt: Date.now(),
  };
  await db.insert(users).values(row);
  return row;
}
