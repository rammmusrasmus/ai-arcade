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
    /** trim().toLowerCase() of displayName, collapsed whitespace — enforces one name per person. */
    displayNameNormalized: text("display_name_normalized"),
    avatarUrl: text("avatar_url"),
    /** scrypt hash for email/password accounts; null for OAuth / dev-login users. */
    passwordHash: text("password_hash"),
    /** Set the first time an emailed login code is confirmed. */
    emailVerifiedAt: integer("email_verified_at"),
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
    displayNameUq: uniqueIndex("users_display_name_uq").on(t.displayNameNormalized),
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
/* auth_challenges — the emailed "confirm it's you" code required on   */
/* every password register/login. Never stores the raw token or code, */
/* only their SHA-256 hashes — same treatment as session tokens.       */
/* ------------------------------------------------------------------ */

export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["login"] }).notNull().default("login"),
    /** sha256 of the opaque token the client holds to reference this challenge. */
    tokenHash: text("token_hash").notNull(),
    /** sha256 of the 6-digit code emailed to the user. */
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    resends: integer("resends").notNull().default(0),
    maxResends: integer("max_resends").notNull().default(3),
    lastSentAt: integer("last_sent_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    tokenUq: uniqueIndex("auth_challenges_token_uq").on(t.tokenHash),
    userIdx: index("auth_challenges_user_idx").on(t.userId),
  }),
);

/* ------------------------------------------------------------------ */
/* password_resets — "forgot password": a 6-digit code is emailed and    */
/* entered in the app together with the token the app holds. Like       */
/* auth_challenges, only SHA-256 hashes of the token and code are stored.*/
/* ------------------------------------------------------------------ */

export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => ({
    tokenUq: uniqueIndex("password_resets_token_uq").on(t.tokenHash),
    userIdx: index("password_resets_user_idx").on(t.userId),
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

/* ------------------------------------------------------------------ */
/* friendships — a request from requesterId to addresseeId; "accepted" */
/* once the addressee confirms. Declining/unfriending/cancelling all   */
/* just delete the row, so this table only ever holds pending or       */
/* accepted relationships.                                             */
/* ------------------------------------------------------------------ */

export const friendships = sqliteTable(
  "friendships",
  {
    id: text("id").primaryKey(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: text("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] }).notNull().default("pending"),
    createdAt: integer("created_at").notNull().default(now),
    respondedAt: integer("responded_at"),
  },
  (t) => ({
    pairUq: uniqueIndex("friendships_pair_uq").on(t.requesterId, t.addresseeId),
    requesterIdx: index("friendships_requester_idx").on(t.requesterId),
    addresseeIdx: index("friendships_addressee_idx").on(t.addresseeId),
  }),
);

/* ------------------------------------------------------------------ */
/* messages — direct messages between friends. conversationKey is the  */
/* two user ids sorted and joined with ":", so a conversation's history */
/* is one indexed range scan regardless of who sent what.               */
/* ------------------------------------------------------------------ */

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationKey: text("conversation_key").notNull(),
    senderId: text("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull().default(now),
    readAt: integer("read_at"),
  },
  (t) => ({
    convIdx: index("messages_conversation_idx").on(t.conversationKey, t.createdAt),
    recipientIdx: index("messages_recipient_idx").on(t.recipientId),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AuthChallengeRow = typeof authChallenges.$inferSelect;
export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameVersionRow = typeof gameVersions.$inferSelect;
export type ReviewEventRow = typeof reviewEvents.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
export type FriendshipRow = typeof friendships.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
