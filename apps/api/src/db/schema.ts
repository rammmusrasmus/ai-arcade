import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

/* ------------------------------------------------------------------ */
/* users                                                              */
/* ------------------------------------------------------------------ */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    /** scrypt hash for email/password accounts; null for OAuth / dev-login users. */
    passwordHash: text("password_hash"),
    bio: text("bio"),
    role: text("role", { enum: ["user", "moderator", "admin"] })
      .notNull()
      .default("user"),
    githubId: text("github_id"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    emailUq: uniqueIndex("users_email_uq").on(t.email),
    githubUq: uniqueIndex("users_github_uq").on(t.githubId),
  }),
);

/* ------------------------------------------------------------------ */
/* sessions                                                           */
/* ------------------------------------------------------------------ */

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => ({
    tokenUq: uniqueIndex("sessions_token_uq").on(t.tokenHash),
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

/* ------------------------------------------------------------------ */
/* games                                                              */
/* ------------------------------------------------------------------ */

export const games = sqliteTable(
  "games",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    /** JSON string[] */
    tags: text("tags").notNull().default("[]"),
    /** JSON string[] */
    aiTools: text("ai_tools").notNull().default("[]"),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected", "unpublished"],
    })
      .notNull()
      .default("draft"),
    playType: text("play_type", { enum: ["html", "external"] }).notNull(),
    externalUrl: text("external_url"),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    currentVersionId: text("current_version_id"),
    coverImageUrl: text("cover_image_url"),
    /** JSON string[] */
    screenshots: text("screenshots").notNull().default("[]"),
    playCount: integer("play_count").notNull().default(0),
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
    publishedAt: integer("published_at"),
  },
  (t) => ({
    slugUq: uniqueIndex("games_slug_uq").on(t.slug),
    statusIdx: index("games_status_idx").on(t.status),
    authorIdx: index("games_author_idx").on(t.authorId),
    publishedIdx: index("games_published_idx").on(t.publishedAt),
  }),
);

/* ------------------------------------------------------------------ */
/* game_versions                                                      */
/* ------------------------------------------------------------------ */

export const gameVersions = sqliteTable(
  "game_versions",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    changelog: text("changelog").notNull().default(""),
    playType: text("play_type", { enum: ["html", "external"] }).notNull(),
    entryPath: text("entry_path"),
    externalUrl: text("external_url"),
    bundleKey: text("bundle_key"),
    bundleBytes: integer("bundle_bytes"),
    unzippedBytes: integer("unzipped_bytes"),
    fileCount: integer("file_count"),
    sha256: text("sha256"),
    /** JSON string[] — absolute http(s) URLs the bundle's HTML/CSS reference. */
    externalRefs: text("external_refs").notNull().default("[]"),
    createdAt: integer("created_at").notNull().default(now),
    reviewedAt: integer("reviewed_at"),
    reviewedBy: text("reviewed_by").references(() => users.id),
  },
  (t) => ({
    gameIdx: index("versions_game_idx").on(t.gameId),
    gameVersionUq: uniqueIndex("versions_game_version_uq").on(t.gameId, t.version),
  }),
);

/* ------------------------------------------------------------------ */
/* review_events                                                      */
/* ------------------------------------------------------------------ */

export const reviewEvents = sqliteTable(
  "review_events",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    versionId: text("version_id"),
    moderatorId: text("moderator_id")
      .notNull()
      .references(() => users.id),
    action: text("action", {
      enum: ["approve", "reject", "request_changes", "unpublish", "comment"],
    }).notNull(),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    gameIdx: index("review_events_game_idx").on(t.gameId),
  }),
);

/* ------------------------------------------------------------------ */
/* ratings                                                            */
/* ------------------------------------------------------------------ */

export const ratings = sqliteTable(
  "ratings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.gameId] }),
    gameIdx: index("ratings_game_idx").on(t.gameId),
  }),
);

/* ------------------------------------------------------------------ */
/* plays (lightweight event log for play counts / basic analytics)    */
/* ------------------------------------------------------------------ */

export const plays = sqliteTable(
  "plays",
  {
    id: text("id").primaryKey(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source", { enum: ["web", "desktop", "unknown"] })
      .notNull()
      .default("unknown"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    gameIdx: index("plays_game_idx").on(t.gameId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameVersionRow = typeof gameVersions.$inferSelect;
export type ReviewEventRow = typeof reviewEvents.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
