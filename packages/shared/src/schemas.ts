import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const UserRole = z.enum(["user", "moderator", "admin"]);
export type UserRole = z.infer<typeof UserRole>;

/**
 * Lifecycle of a game in the catalog.
 * - draft:       created by author, not yet submitted
 * - pending:     submitted, waiting in the moderation queue
 * - approved:    live in the store
 * - rejected:    moderator rejected the current submission
 * - unpublished: was live, taken down by a moderator or the author
 */
export const GameStatus = z.enum([
  "draft",
  "pending",
  "approved",
  "rejected",
  "unpublished",
]);
export type GameStatus = z.infer<typeof GameStatus>;

/** How a game is played. */
export const PlayType = z.enum(["html", "external"]);
export type PlayType = z.infer<typeof PlayType>;

export const VersionStatus = z.enum(["pending", "approved", "rejected"]);
export type VersionStatus = z.infer<typeof VersionStatus>;

export const ReviewAction = z.enum([
  "approve",
  "reject",
  "request_changes",
  "unpublish",
  "comment",
]);
export type ReviewAction = z.infer<typeof ReviewAction>;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const Slug = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words separated by hyphens");

export const Tag = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[a-z0-9][a-z0-9- ]*$/i, "letters, numbers, spaces and hyphens");

export const TagList = z.array(Tag).max(12).default([]);

/* ------------------------------------------------------------------ */
/* Entities (API representations)                                      */
/* ------------------------------------------------------------------ */

export const User = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  bio: z.string().nullable(),
  role: UserRole,
  /** Whether this account can sign in with an email + password. */
  hasPassword: z.boolean(),
  /** Confirmed at least once via the emailed sign-in code. */
  emailVerified: z.boolean(),
  createdAt: z.string(),
});
export type User = z.infer<typeof User>;

/* ------------------------------------------------------------------ */
/* Auth request bodies                                                 */
/* ------------------------------------------------------------------ */

export const Password = z.string().min(8, "at least 8 characters").max(200);

export const RegisterInput = z.object({
  email: z.string().email().max(200),
  password: Password,
  displayName: z.string().min(2).max(60),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: Password,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

export const UpdateProfileInput = z.object({
  displayName: z.string().min(2).max(60).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export const AuthResult = z.object({
  token: z.string(),
  user: User,
});
export type AuthResult = z.infer<typeof AuthResult>;

/**
 * Registering or logging in with a password never returns a session directly —
 * it starts a challenge: a 6-digit code is emailed, and the client must send it
 * back (with this token) to `POST /auth/verify-login` to actually get a session.
 */
export const LoginChallenge = z.object({
  pending: z.literal(true),
  loginToken: z.string(),
  email: z.string().email(),
  expiresInSeconds: z.number().int().positive(),
});
export type LoginChallenge = z.infer<typeof LoginChallenge>;

export const VerifyLoginInput = z.object({
  loginToken: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "6-digit code"),
});
export type VerifyLoginInput = z.infer<typeof VerifyLoginInput>;

export const ResendLoginInput = z.object({
  loginToken: z.string().min(1),
});
export type ResendLoginInput = z.infer<typeof ResendLoginInput>;

export const ForgotPasswordInput = z.object({
  email: z.string().email().max(200),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({
  token: z.string().min(1),
  newPassword: Password,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** A minimal public author reference embedded in game payloads. */
export const AuthorRef = z.object({
  id: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
});
export type AuthorRef = z.infer<typeof AuthorRef>;

export const GameVersion = z.object({
  id: z.string(),
  gameId: z.string(),
  version: z.number().int().positive(),
  status: VersionStatus,
  changelog: z.string(),
  playType: PlayType,
  /** For playType "html": entry file inside the bundle, e.g. "index.html". */
  entryPath: z.string().nullable(),
  /** For playType "external": the URL the game lives at. */
  externalUrl: z.string().url().nullable(),
  bundleBytes: z.number().int().nonnegative().nullable(),
  unzippedBytes: z.number().int().nonnegative().nullable(),
  fileCount: z.number().int().nonnegative().nullable(),
  sha256: z.string().nullable(),
  /**
   * Absolute http(s) URLs this bundle's HTML/CSS reference. The desktop client
   * blocks all network egress except the multiplayer relay, so these will not
   * load there. Empty for a self-contained bundle.
   */
  externalRefs: z.array(z.string()).default([]),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type GameVersion = z.infer<typeof GameVersion>;

export const GameStats = z.object({
  playCount: z.number().int().nonnegative(),
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.number().int().nonnegative(),
});
export type GameStats = z.infer<typeof GameStats>;

export const Game = z.object({
  id: z.string(),
  slug: Slug,
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  tags: z.array(Tag),
  status: GameStatus,
  playType: PlayType,
  /** For playType "external": where the game is hosted. */
  externalUrl: z.string().url().nullable(),
  author: AuthorRef,
  coverImageUrl: z.string().url().nullable(),
  screenshots: z.array(z.string().url()),
  aiTools: z.array(z.string()).describe("AI tools used to build the game, e.g. 'Claude'"),
  stats: GameStats,
  /** The currently playable version (approved). Null while first submission is pending. */
  currentVersion: GameVersion.nullable(),
  /** Only populated in the moderation queue: the version awaiting review. */
  pendingVersion: GameVersion.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
});
export type Game = z.infer<typeof Game>;

export const ReviewEvent = z.object({
  id: z.string(),
  gameId: z.string(),
  versionId: z.string().nullable(),
  action: ReviewAction,
  note: z.string(),
  moderator: AuthorRef,
  createdAt: z.string(),
});
export type ReviewEvent = z.infer<typeof ReviewEvent>;

export const Rating = z.object({
  gameId: z.string(),
  value: z.number().int().min(1).max(5),
  createdAt: z.string(),
});
export type Rating = z.infer<typeof Rating>;

/* ------------------------------------------------------------------ */
/* Request bodies                                                      */
/* ------------------------------------------------------------------ */

export const CreateGameInput = z.object({
  title: z.string().min(3).max(80),
  slug: Slug.optional(),
  summary: z.string().min(10).max(160),
  description: z.string().min(0).max(8000).default(""),
  tags: TagList,
  aiTools: z.array(z.string().min(1).max(40)).max(10).default([]),
  playType: PlayType,
  /** Required when playType === "external". */
  externalUrl: z.string().url().optional(),
});
export type CreateGameInput = z.infer<typeof CreateGameInput>;

export const UpdateGameInput = z.object({
  title: z.string().min(3).max(80).optional(),
  summary: z.string().min(10).max(160).optional(),
  description: z.string().max(8000).optional(),
  tags: TagList.optional(),
  aiTools: z.array(z.string().min(1).max(40)).max(10).optional(),
  externalUrl: z.string().url().optional(),
});
export type UpdateGameInput = z.infer<typeof UpdateGameInput>;

/** Multipart: the zip is sent as a file part; this is the JSON "meta" part. */
export const CreateVersionMeta = z.object({
  changelog: z.string().max(2000).default(""),
  /** Override the detected entry file inside the bundle. */
  entryPath: z.string().max(200).optional(),
});
export type CreateVersionMeta = z.infer<typeof CreateVersionMeta>;

export const SubmitForReviewInput = z.object({
  note: z.string().max(2000).default(""),
});
export type SubmitForReviewInput = z.infer<typeof SubmitForReviewInput>;

export const ModerationDecisionInput = z.object({
  action: ReviewAction,
  note: z.string().max(4000).default(""),
});
export type ModerationDecisionInput = z.infer<typeof ModerationDecisionInput>;

export const RateGameInput = z.object({
  value: z.number().int().min(1).max(5),
});
export type RateGameInput = z.infer<typeof RateGameInput>;

export const ListGamesQuery = z.object({
  q: z.string().max(120).optional(),
  tag: z.string().max(24).optional(),
  aiTool: z.string().max(40).optional(),
  sort: z.enum(["newest", "popular", "top_rated", "updated"]).default("newest"),
  status: GameStatus.optional(),
  authorId: z.string().optional(),
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type ListGamesQuery = z.infer<typeof ListGamesQuery>;

/* ------------------------------------------------------------------ */
/* Response envelopes                                                  */
/* ------------------------------------------------------------------ */

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const SessionInfo = z.object({
  user: User.nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;
