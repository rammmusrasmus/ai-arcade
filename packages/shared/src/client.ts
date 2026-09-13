import type {
  AuthResult,
  ChangePasswordInput,
  CreateGameInput,
  CreateVersionMeta,
  ForgotPasswordInput,
  Game,
  GameVersion,
  ListGamesQuery,
  LoginChallenge,
  LoginInput,
  ModerationDecisionInput,
  Paginated,
  RateGameInput,
  RegisterInput,
  ResendLoginInput,
  ResetPasswordInput,
  ReviewEvent,
  SessionInfo,
  SubmitForReviewInput,
  UpdateGameInput,
  UpdateProfileInput,
  User,
  VerifyLoginInput,
} from "./schemas.js";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current bearer token, or null/undefined if signed out. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Extra headers added to every request (e.g. a CSRF marker). */
  defaultHeaders?: () => HeadersInit;
  /** Send cookies (used by the web app; harmless for desktop). */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: ApiClientOptions["getToken"];
  private readonly defaultHeaders?: ApiClientOptions["defaultHeaders"];
  private readonly credentials: RequestCredentials;
  private readonly _fetch: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.getToken = opts.getToken;
    this.defaultHeaders = opts.defaultHeaders;
    this.credentials = opts.credentials ?? "include";
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async headers(extra?: HeadersInit): Promise<Headers> {
    const h = new Headers(this.defaultHeaders ? this.defaultHeaders() : undefined);
    new Headers(extra).forEach((value, key) => h.set(key, value));
    const token = this.getToken ? await this.getToken() : null;
    if (token) h.set("authorization", `Bearer ${token}`);
    return h;
  }

  private url(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = body?.error ?? {};
      throw new ApiClientError(
        res.status,
        err.code ?? "http_error",
        err.message ?? res.statusText,
        err.details,
      );
    }
    return body as T;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; json?: unknown; body?: BodyInit } = {},
  ): Promise<T> {
    const headers = await this.headers();
    let body: BodyInit | undefined = opts.body;
    if (opts.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(opts.json);
    }
    const res = await this._fetch(this.url(path, opts.query), {
      method,
      headers,
      body,
      credentials: this.credentials,
    });
    return this.parse<T>(res);
  }

  /* ---------------- auth ---------------- */

  authProviders(): Promise<{
    password: boolean;
    github: boolean;
    devLogin: boolean;
    emailDeliveryConfigured: boolean;
  }> {
    return this.request("GET", "/auth/providers");
  }

  /** URL to send the browser to in order to start GitHub OAuth. */
  githubLoginUrl(returnTo?: string): string {
    return this.url("/auth/github", { returnTo });
  }

  /** Creates the account, emails a 6-digit code, and returns a pending challenge. */
  register(input: RegisterInput): Promise<LoginChallenge> {
    return this.request("POST", "/auth/register", { json: input });
  }

  /** Checks the password, emails a 6-digit code, and returns a pending challenge. */
  login(input: LoginInput): Promise<LoginChallenge> {
    return this.request("POST", "/auth/login", { json: input });
  }

  /** Completes register/login: the code from email + the challenge's token → a session. */
  verifyLogin(input: VerifyLoginInput): Promise<AuthResult> {
    return this.request("POST", "/auth/verify-login", { json: input });
  }

  /** Requests a fresh code for a still-open challenge (rate-limited). */
  resendLoginCode(input: ResendLoginInput): Promise<{ ok: true; expiresInSeconds: number }> {
    return this.request("POST", "/auth/resend-login", { json: input });
  }

  changePassword(input: ChangePasswordInput): Promise<{ ok: true }> {
    return this.request("POST", "/auth/change-password", { json: input });
  }

  /** Always resolves the same way, whether or not that email has an account. */
  forgotPassword(input: ForgotPasswordInput): Promise<{ ok: true }> {
    return this.request("POST", "/auth/forgot-password", { json: input });
  }

  /** Sets a new password from an emailed reset link's token, and signs out every session. */
  resetPassword(input: ResetPasswordInput): Promise<{ ok: true }> {
    return this.request("POST", "/auth/reset-password", { json: input });
  }

  updateProfile(input: UpdateProfileInput): Promise<{ user: User }> {
    return this.request("PATCH", "/me", { json: input });
  }

  /** Local-only passwordless login. Returns a bearer token + user. */
  devLogin(email: string, displayName?: string): Promise<{ token: string; user: User }> {
    return this.request("POST", "/auth/dev-login", { json: { email, displayName } });
  }

  session(): Promise<SessionInfo> {
    return this.request("GET", "/auth/session");
  }

  logout(): Promise<{ ok: true }> {
    return this.request("POST", "/auth/logout");
  }

  /* ---------------- catalog ---------------- */

  listGames(query?: Partial<ListGamesQuery>): Promise<Paginated<Game>> {
    return this.request("GET", "/games", { query: query as Query });
  }

  getGame(slugOrId: string): Promise<Game> {
    return this.request("GET", `/games/${encodeURIComponent(slugOrId)}`);
  }

  getGameVersions(gameId: string): Promise<GameVersion[]> {
    return this.request("GET", `/games/${encodeURIComponent(gameId)}/versions`);
  }

  /** Records a play and returns the URL to load the game from. */
  play(
    gameId: string,
  ): Promise<{ url: string; playType: "html" | "external"; mpUrl: string | null }> {
    return this.request("POST", `/games/${encodeURIComponent(gameId)}/play`);
  }

  rateGame(gameId: string, input: RateGameInput): Promise<{ ratingAvg: number; ratingCount: number }> {
    return this.request("POST", `/games/${encodeURIComponent(gameId)}/rate`, { json: input });
  }

  listTags(): Promise<{ tag: string; count: number }[]> {
    return this.request("GET", "/tags");
  }

  /* ---------------- authoring ---------------- */

  createGame(input: CreateGameInput): Promise<Game> {
    return this.request("POST", "/games", { json: input });
  }

  updateGame(gameId: string, input: UpdateGameInput): Promise<Game> {
    return this.request("PATCH", `/games/${encodeURIComponent(gameId)}`, { json: input });
  }

  /**
   * Upload a new bundle version. `bundle` is a zip File/Blob.
   * Only meaningful for playType "html".
   */
  async uploadVersion(
    gameId: string,
    bundle: Blob,
    meta: Partial<CreateVersionMeta> = {},
  ): Promise<GameVersion> {
    const form = new FormData();
    form.set("meta", JSON.stringify(meta));
    form.set("bundle", bundle, "bundle.zip");
    return this.request("POST", `/games/${encodeURIComponent(gameId)}/versions`, { body: form });
  }

  submitForReview(gameId: string, input: SubmitForReviewInput = { note: "" }): Promise<Game> {
    return this.request("POST", `/games/${encodeURIComponent(gameId)}/submit`, { json: input });
  }

  unpublishOwnGame(gameId: string): Promise<Game> {
    return this.request("POST", `/games/${encodeURIComponent(gameId)}/unpublish`);
  }

  myGames(): Promise<Game[]> {
    return this.request("GET", "/me/games");
  }

  uploadImage(file: Blob): Promise<{ url: string }> {
    const form = new FormData();
    form.set("image", file);
    return this.request("POST", "/uploads/image", { body: form });
  }

  setGameMedia(
    gameId: string,
    media: { coverImageUrl?: string | null; screenshots?: string[] },
  ): Promise<Game> {
    return this.request("PUT", `/games/${encodeURIComponent(gameId)}/media`, { json: media });
  }

  /* ---------------- moderation ---------------- */

  moderationQueue(): Promise<Game[]> {
    return this.request("GET", "/moderation/queue");
  }

  decideModeration(gameId: string, input: ModerationDecisionInput): Promise<Game> {
    return this.request("POST", `/moderation/games/${encodeURIComponent(gameId)}/decide`, {
      json: input,
    });
  }

  reviewHistory(gameId: string): Promise<ReviewEvent[]> {
    return this.request("GET", `/moderation/games/${encodeURIComponent(gameId)}/history`);
  }
}
