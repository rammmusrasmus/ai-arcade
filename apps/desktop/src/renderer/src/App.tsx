import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient, PlayType } from "@ai-arcade/shared";
import type { AuthorRef, Friend, FriendRequest, Game, Message, User } from "@ai-arcade/shared";
import type { InstalledGame, PickedBundle, UpdateState } from "../../preload/index";
import { errorMessage, makeApi, setToken } from "./api";

function b64ToBlob(b64: string, type = "application/zip"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

type Tab = "store" | "library" | "review" | "friends";

export function App() {
  const [api, setApi] = useState<ApiClient | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("store");
  const [library, setLibrary] = useState<InstalledGame[]>([]);
  const [booted, setBooted] = useState(false);

  const refreshSession = useCallback(async (client: ApiClient) => {
    try {
      const { user } = await client.session();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  const [bootError, setBootError] = useState<string | null>(null);
  // gameId -> latest approved version number in the catalog
  const [latestVersions, setLatestVersions] = useState<Record<string, number>>({});

  const checkGameUpdates = useCallback(async (client: ApiClient, games: InstalledGame[]) => {
    const entries = await Promise.all(
      games.map(async (g) => {
        try {
          const full = await client.getGame(g.gameId);
          return [g.gameId, full.currentVersion?.version ?? 0] as const;
        } catch {
          return [g.gameId, 0] as const;
        }
      }),
    );
    setLatestVersions(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const client = await makeApi();
        const cfg = await window.arcade.getConfig();
        setApiUrl(cfg.apiUrl);
        setApi(client);
        const lib = await window.arcade.listLibrary();
        setLibrary(lib);
        await refreshSession(client);
        void checkGameUpdates(client, lib);
      } catch (err) {
        setBootError(errorMessage(err));
      } finally {
        setBooted(true);
      }
    })();
    const off = window.arcade.onLibraryChanged((games) => {
      setLibrary(games);
      void makeApi().then((c) => checkGameUpdates(c, games));
    });
    return off;
  }, [refreshSession, checkGameUpdates]);

  // Re-check for game updates whenever the user opens the Library.
  useEffect(() => {
    if (tab === "library" && api && library.length) void checkGameUpdates(api, library);
  }, [tab, api, library, checkGameUpdates]);

  const installed = useMemo(
    () => new Map(library.map((g) => [g.gameId, g] as const)),
    [library],
  );

  const outdated = useMemo(
    () =>
      library.filter((g) => (latestVersions[g.gameId] ?? 0) > g.version).map((g) => g.gameId),
    [library, latestVersions],
  );

  const [uploadOpen, setUploadOpen] = useState(false);

  // Badge on the Friends tab: unread messages + incoming friend requests.
  const [friendBadge, setFriendBadge] = useState(0);
  useEffect(() => {
    if (!api || !user) {
      setFriendBadge(0);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const [friends, requests] = await Promise.all([api.listFriends(), api.listFriendRequests()]);
        if (cancelled) return;
        const unread = friends.reduce((n, f) => n + f.unreadCount, 0);
        setFriendBadge(unread + requests.incoming.length);
      } catch {
        /* transient — try again next tick */
      }
    };
    void poll();
    const t = setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [api, user]);

  if (!booted) {
    return <div className="empty">Connecting to {apiUrl || "the arcade"}…</div>;
  }

  if (!api) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">▶</span> AI Arcade
          </div>
          <div className="spacer" />
          <ServerControl currentUrl={apiUrl} />
        </header>
        <main className="content">
          <div className="empty">
            <p className="error" style={{ maxWidth: 460, margin: "0 auto 14px" }}>
              Couldn’t reach the server at <b>{apiUrl}</b>.
              {bootError ? <><br />{bootError}</> : null}
            </p>
            <p className="muted">Use the <b>Server</b> button above to point at the right address, then it reloads.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▶</span> AI Arcade
        </div>
        <div className="tabs">
          <button
            className={`tab ${tab === "store" ? "active" : ""}`}
            onClick={() => setTab("store")}
          >
            Store
          </button>
          <button
            className={`tab ${tab === "library" ? "active" : ""}`}
            onClick={() => setTab("library")}
          >
            Library {library.length > 0 && <span className="badge">{library.length}</span>}
            {outdated.length > 0 && (
              <span className="badge" style={{ background: "#3a2a12", borderColor: "#7a5a1f", color: "#ffd58a" }}>
                ⬆ {outdated.length}
              </span>
            )}
          </button>
          {(user?.role === "moderator" || user?.role === "admin") && (
            <button
              className={`tab ${tab === "review" ? "active" : ""}`}
              onClick={() => setTab("review")}
            >
              Review
            </button>
          )}
          {user && (
            <button
              className={`tab ${tab === "friends" ? "active" : ""}`}
              onClick={() => setTab("friends")}
            >
              Friends {friendBadge > 0 && <span className="badge">{friendBadge}</span>}
            </button>
          )}
        </div>
        <div className="spacer" />
        <button
          className="btn primary sm"
          onClick={() => (user ? setUploadOpen(true) : undefined)}
          title={user ? "Share a game you made" : "Sign in to upload a game"}
          disabled={!user}
        >
          ＋ Upload game
        </button>
        <ServerControl currentUrl={apiUrl} />
        <AccountControl api={api} user={user} onChange={() => refreshSession(api)} />
      </header>

      <UpdateBanner />

      {uploadOpen && (
        <UploadGameModal
          api={api}
          onClose={() => setUploadOpen(false)}
          onDone={() => {
            setUploadOpen(false);
            setTab("store");
          }}
        />
      )}

      <main className="content">
        {tab === "store" ? (
          <StoreView api={api} apiUrl={apiUrl} installed={installed} />
        ) : tab === "review" ? (
          <ReviewView api={api} />
        ) : tab === "friends" ? (
          user ? (
            <FriendsView api={api} me={user} />
          ) : (
            <div className="empty">Sign in to see your friends.</div>
          )
        ) : (
          <LibraryView library={library} latestVersions={latestVersions} />
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------- */

function UpdateBanner() {
  const [s, setS] = useState<UpdateState>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.arcade.getUpdateState().then(setS).catch(() => undefined);
    return window.arcade.onUpdateStatus((next) => {
      setS(next);
      setDismissed(false);
    });
  }, []);

  if (s.state === "ready") {
    return (
      <div
        className="row"
        style={{
          justifyContent: "center",
          gap: 12,
          padding: "8px 14px",
          background: "linear-gradient(90deg,#1c2b1f,#14231a)",
          borderBottom: "1px solid #1f5a3d",
          fontSize: 13,
        }}
      >
        <span>
          <b>Update {s.version}</b> downloaded.
        </span>
        <button className="btn primary sm" onClick={() => window.arcade.installUpdate()}>
          Restart &amp; update
        </button>
      </div>
    );
  }

  if (s.state === "downloading") {
    return (
      <div
        className="stat"
        style={{ textAlign: "center", padding: "5px 14px", borderBottom: "1px solid var(--border)" }}
      >
        Downloading update{s.version ? ` ${s.version}` : ""}
        {typeof s.percent === "number" ? ` — ${s.percent}%` : "…"}
      </div>
    );
  }

  if (s.state === "error" && !dismissed) {
    return (
      <div
        className="stat"
        style={{ textAlign: "center", padding: "5px 14px", borderBottom: "1px solid var(--border)", color: "var(--danger)" }}
      >
        Update check failed: {s.message}{" "}
        <button className="btn ghost sm" onClick={() => setDismissed(true)}>
          dismiss
        </button>
      </div>
    );
  }

  return null;
}

/* -------------------------------------------------------------- */

function ReviewView({ api }: { api: ApiClient }) {
  const [queue, setQueue] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const preview = async (g: Game, versionId: string) => {
    setPreviewingId(versionId);
    setError(null);
    try {
      const r = await window.arcade.previewBuild(g.id, versionId, g.title);
      if (!r.ok) setError(r.error ?? "Couldn't open this build");
    } finally {
      setPreviewingId(null);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue(await api.moderationQueue());
    } catch (err) {
      setError(errorMessage(err));
      setQueue([]);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (g: Game, action: "approve" | "reject" | "request_changes") => {
    setBusyId(g.id);
    setError(null);
    try {
      await api.decideModeration(g.id, { action, note: notes[g.id] ?? "" });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1>Review queue</h1>
      {error && <div className="error">{error}</div>}
      {!queue ? (
        <div className="empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="empty">Nothing waiting for review.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {queue.map((g) => {
            const pv = g.pendingVersion;
            const busy = busyId === g.id;
            return (
              <div className="card" key={g.id} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>{g.title}</h3>
                  <span className="badge">{g.status}</span>
                </div>
                <p className="stat">
                  by {g.author.displayName} · {g.playType} ·{" "}
                  {g.status === "approved" ? "update to a live game" : "first submission"}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>{g.summary}</p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }} >
                  {g.tags.map((t) => (
                    <span className="badge" key={t}>{t}</span>
                  ))}
                  {g.aiTools.map((t) => (
                    <span className="badge" key={t}>🤖 {t}</span>
                  ))}
                </div>
                {pv && (
                  <p className="stat">
                    pending v{pv.version}
                    {pv.fileCount != null ? ` · ${pv.fileCount} files` : ""}
                    {pv.unzippedBytes != null ? ` · ${(pv.unzippedBytes / 1024).toFixed(0)} KB` : ""}
                    {pv.entryPath ? ` · entry ${pv.entryPath}` : ""}
                  </p>
                )}
                {pv && pv.externalRefs && pv.externalRefs.length > 0 && (
                  <div className="stat" style={{ color: "#ffd58a" }}>
                    ⚠ references {pv.externalRefs.length} external URL(s) — won’t load in the
                    desktop client:
                    <div style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all", marginTop: 2 }}>
                      {pv.externalRefs.join("  ")}
                    </div>
                  </div>
                )}
                {pv && pv.playType === "html" && (
                  <div className="row">
                    <button
                      className="btn sm"
                      disabled={previewingId === pv.id}
                      onClick={() => preview(g, pv.id)}
                    >
                      {previewingId === pv.id ? "Downloading…" : `▶ Play this build (v${pv.version})`}
                    </button>
                  </div>
                )}
                {pv && pv.playType === "external" && (
                  <p className="stat" style={{ wordBreak: "break-all" }}>
                    Hosted outside AI Arcade at {pv.externalUrl ?? g.externalUrl ?? "(no URL)"}
                  </p>
                )}
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Note to the author (required to reject)…"
                  value={notes[g.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [g.id]: e.target.value }))}
                />
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <button className="btn primary" disabled={busy} onClick={() => decide(g, "approve")}>
                    Approve &amp; publish
                  </button>
                  <button
                    className="btn"
                    disabled={busy || !(notes[g.id] ?? "").trim()}
                    onClick={() => decide(g, "request_changes")}
                  >
                    Request changes
                  </button>
                  <button
                    className="btn danger sm"
                    disabled={busy || !(notes[g.id] ?? "").trim()}
                    onClick={() => decide(g, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- */

function UploadGameModal({
  api,
  onClose,
  onDone,
}: {
  api: ApiClient;
  onClose: () => void;
  onDone: () => void;
}) {
  const [playType, setPlayType] = useState<PlayType>("html");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [aiTools, setAiTools] = useState("Claude");
  const [externalUrl, setExternalUrl] = useState("");
  const [bundle, setBundle] = useState<PickedBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const pick = async (kind: "folder" | "zip") => {
    setError(null);
    const res =
      kind === "folder" ? await window.arcade.pickGameFolder() : await window.arcade.pickGameZip();
    if (!res) return; // cancelled
    if (res.error) {
      setError(res.error);
      return;
    }
    if (kind === "folder" && res.hasEntry === false) {
      setError("That folder has no index.html — the game needs an HTML entry point.");
      return;
    }
    setBundle(res);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const game = await api.createGame({
        title: title.trim(),
        summary: summary.trim(),
        description: description.trim(),
        tags: splitList(tags),
        aiTools: splitList(aiTools),
        playType,
        externalUrl: playType === "external" ? externalUrl.trim() : undefined,
      });

      if (playType === "html") {
        if (!bundle?.zipBase64) throw new Error("Choose your game folder or .zip first.");
        await api.uploadVersion(game.slug, b64ToBlob(bundle.zipBase64), {
          changelog: "Initial upload",
        });
      }
      await api.submitForReview(game.slug, { note: "" });
      setDone(game.title);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    title.trim().length >= 3 &&
    summary.trim().length >= 10 &&
    (playType === "external" ? /^https?:\/\//.test(externalUrl.trim()) : Boolean(bundle?.zipBase64));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 100,
        display: "grid",
        placeItems: "start center",
        overflow: "auto",
        padding: "40px 16px",
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "100%", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Upload a game</h2>
          <button className="btn ghost sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ color: "#7ef0b0" }}>
              <b>{done}</b> was submitted for review. A moderator approves it before it shows in
              the Store.
            </p>
            <button className="btn primary" onClick={onDone}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="tabs" style={{ background: "var(--bg)", borderRadius: 8, padding: 3 }}>
              {(["html", "external"] as PlayType[]).map((t) => (
                <button
                  key={t}
                  className={`tab ${playType === t ? "active" : ""}`}
                  style={{ flex: 1 }}
                  onClick={() => setPlayType(t)}
                >
                  {t === "html" ? "Upload files" : "Link to a hosted game"}
                </button>
              ))}
            </div>

            <label className="stat">
              Title
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="stat">
              One-line summary
              <input
                className="input"
                maxLength={160}
                placeholder="Shown on the store card (10–160 chars)"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </label>
            <label className="stat">
              Description (optional)
              <textarea
                className="input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 10 }}>
              <label className="stat" style={{ flex: 1 }}>
                Tags (comma-sep)
                <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
              <label className="stat" style={{ flex: 1 }}>
                AI tools used
                <input
                  className="input"
                  value={aiTools}
                  onChange={(e) => setAiTools(e.target.value)}
                />
              </label>
            </div>

            {playType === "external" ? (
              <label className="stat">
                Game URL
                <input
                  className="input"
                  placeholder="https://…"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                />
              </label>
            ) : (
              <div className="card" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
                <div className="stat">
                  Pick the folder with your <code>index.html</code> (everything gets zipped flat),
                  or an existing <code>.zip</code>. <b>Bundle all assets</b> — the desktop client
                  blocks outside network access, so CDN scripts / web fonts won’t load.
                </div>
                <div className="row">
                  <button className="btn" onClick={() => pick("folder")}>
                    Choose folder…
                  </button>
                  <button className="btn ghost" onClick={() => pick("zip")}>
                    Choose .zip…
                  </button>
                </div>
                {bundle && (
                  <div className="stat">
                    ✓ {bundle.files?.length ?? 0} file(s), {((bundle.sizeBytes ?? 0) / 1024).toFixed(0)} KB
                    {bundle.source ? ` — ${bundle.source}` : ""}
                    {bundle.externalRefs && bundle.externalRefs.length > 0 && (
                      <div style={{ color: "#ffd58a", marginTop: 4 }}>
                        ⚠ references {bundle.externalRefs.length} external URL(s) — these won’t load
                        in the desktop app. Bundle them instead.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <button className="btn primary" disabled={busy || !canSubmit} onClick={submit}>
              {busy ? "Submitting…" : "Submit for review"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- */

function ServerControl({ currentUrl }: { currentUrl: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = currentUrl.replace(/^https?:\/\//, "");

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      if (next) {
        // sanity check the URL before committing
        // eslint-disable-next-line no-new
        new URL(next);
      }
      await window.arcade.setServerUrl(next);
      location.reload(); // re-boot the renderer against the new server
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL");
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)} title={currentUrl}>
        🌐 {short.length > 26 ? short.slice(0, 24) + "…" : short}
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, top: 34, width: 340, padding: 14, zIndex: 30, gap: 10 }}
        >
          <div className="stat">Server (API + multiplayer relay)</div>
          <input
            className="input"
            placeholder="https://your-server.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
          <div className="stat">
            Paste the URL your host shared (e.g. a Cloudflare/ngrok tunnel or a deployed
            server). The relay is the same URL — no second field.
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || !url.trim()} onClick={() => save(url.trim())}>
              {busy ? "Reloading…" : "Save & reconnect"}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => save(null)}>
              Reset to localhost
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
            <span className="stat">Updates check on launch</span>
            <button
              className="btn ghost sm"
              onClick={() =>
                window.arcade.checkForUpdate().then((s) => {
                  if (s.state === "unsupported") setError("Auto-update needs the installer build.");
                  else if (s.state === "idle") setError("You're on the latest version.");
                  else setError(null);
                })
              }
            >
              Check now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- */

function AccountControl({
  api,
  user,
  onChange,
}: {
  api: ApiClient;
  user: User | null;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [providers, setProviders] = useState({
    password: true,
    github: false,
    devLogin: false,
    emailDeliveryConfigured: false,
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // set once register/login returns a pending challenge; shows the code step
  const [challenge, setChallenge] = useState<{ loginToken: string; email: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.authProviders().then(setProviders).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (user) {
    return (
      <div className="row">
        <span className="muted" title={user.email}>
          {user.displayName}
        </span>
        <button
          className="btn ghost sm"
          onClick={async () => {
            await api.logout().catch(() => undefined);
            await setToken(null);
            onChange();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "register"
          ? await api.register({ email, password, displayName })
          : await api.login({ email, password });
      setChallenge({ loginToken: res.loginToken, email: res.email });
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyLogin({ loginToken: challenge.loginToken, code });
      await setToken(res.token);
      setOpen(false);
      setChallenge(null);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)}>
        Sign in
      </button>
      {open && (
        <div
          className="card"
          style={{ position: "absolute", right: 0, top: 34, width: 300, padding: 14, zIndex: 20, gap: 10 }}
        >
          {resetting ? (
            <ResetPasswordPanel
              api={api}
              initialEmail={email}
              emailDeliveryConfigured={providers.emailDeliveryConfigured}
              onCancel={() => setResetting(false)}
              onDone={(resetEmail) => {
                setResetting(false);
                setMode("signin");
                setEmail(resetEmail);
                setPassword("");
                setNotice("Password changed — sign in with your new password.");
              }}
            />
          ) : challenge ? (
            <>
              <div className="stat">
                Code sent to <b>{challenge.email}</b>.
                {!providers.emailDeliveryConfigured && " No mail provider configured — check the API server console."}
              </div>
              <input
                className="input"
                style={{ textAlign: "center", fontSize: 20, letterSpacing: 6 }}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && verify()}
              />
              <button className="btn primary" disabled={busy || code.length !== 6} onClick={verify}>
                {busy ? "Checking…" : "Confirm"}
              </button>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <button className="btn ghost sm" onClick={() => setChallenge(null)}>
                  ← Back
                </button>
                <button
                  className="btn ghost sm"
                  disabled={cooldown > 0 || busy}
                  onClick={async () => {
                    setError(null);
                    setNotice(null);
                    try {
                      await api.resendLoginCode({ loginToken: challenge.loginToken });
                      setNotice("Sent a new code.");
                      setCooldown(30);
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                >
                  {cooldown > 0 ? `Resend (${cooldown}s)` : "Resend"}
                </button>
              </div>
              {notice && <div className="stat" style={{ color: "#7ef0b0" }}>{notice}</div>}
            </>
          ) : providers.password ? (
            <>
              <div className="tabs" style={{ background: "var(--bg)", borderRadius: 8, padding: 3 }}>
                {(["signin", "register"] as const).map((m) => (
                  <button
                    key={m}
                    className={`tab ${mode === m ? "active" : ""}`}
                    style={{ flex: 1 }}
                    onClick={() => {
                      setMode(m);
                      setError(null);
                    }}
                  >
                    {m === "signin" ? "Sign in" : "Register"}
                  </button>
                ))}
              </div>
              {mode === "register" && (
                <input
                  className="input"
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              )}
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder={mode === "register" ? "Password (min 8)" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              {mode === "signin" && (
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ alignSelf: "flex-end" }}
                  onClick={() => {
                    setError(null);
                    setResetting(true);
                  }}
                >
                  Forgot password?
                </button>
              )}
              <button
                className="btn primary"
                disabled={busy || !email || !password || (mode === "register" && displayName.length < 2)}
                onClick={submit}
              >
                {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
              {notice && <div className="stat" style={{ color: "#7ef0b0" }}>{notice}</div>}
            </>
          ) : (
            <div className="stat">Password sign-in is disabled on this server.</div>
          )}

          {!challenge && !resetting && providers.devLogin && (
            <button
              className="btn ghost sm"
              disabled={busy || !email}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await api.devLogin(email || "dev@example.com");
                  await setToken(res.token);
                  setOpen(false);
                  onChange();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Dev login (local)
            </button>
          )}

          {error && <div className="error">{error}</div>}
        </div>
      )}
    </div>
  );
}

function ResetPasswordPanel({
  api,
  initialEmail,
  emailDeliveryConfigured,
  onCancel,
  onDone,
}: {
  api: ApiClient;
  initialEmail: string;
  emailDeliveryConfigured: boolean;
  onCancel: () => void;
  onDone: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgotPassword({ email });
      setResetToken(res.resetToken);
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!resetToken) return;
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ resetToken, code, newPassword });
      onDone(email.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <b>Reset your password</b>
      {!resetToken ? (
        <>
          <div className="stat">Enter your account's email and we'll send you a reset code.</div>
          <input
            className="input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email && requestCode()}
          />
          <button className="btn primary" disabled={busy || !email} onClick={requestCode}>
            {busy ? "Sending…" : "Send reset code"}
          </button>
        </>
      ) : (
        <>
          <div className="stat">
            If <b>{email}</b> has an account, a 6-digit code is on its way. It expires in 15 minutes.
            {!emailDeliveryConfigured && " No mail provider configured — check the API server console."}
          </div>
          <input
            className="input"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: 6 }}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <input
            className="input"
            type="password"
            placeholder="New password (min 8)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reset()}
          />
          <button
            className="btn primary"
            disabled={busy || code.length !== 6 || newPassword.length < 8 || !confirm}
            onClick={reset}
          >
            {busy ? "Saving…" : "Set new password"}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={requestCode}>
            Send a new code
          </button>
        </>
      )}
      <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={onCancel}>
        ← Back to sign in
      </button>
      {error && <div className="error">{error}</div>}
    </>
  );
}

/* -------------------------------------------------------------- */

function FriendsView({ api, me }: { api: ApiClient; me: User }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<{ incoming: FriendRequest[]; outgoing: FriendRequest[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuthorRef | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthorRef[]>([]);

  const loadFriends = useCallback(async () => {
    try {
      setFriends(await api.listFriends());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await api.listFriendRequests());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void loadFriends();
    void loadRequests();
  }, [loadFriends, loadRequests]);

  useEffect(() => {
    const t = setInterval(() => {
      void loadFriends();
      void loadRequests();
    }, 15_000);
    return () => clearInterval(t);
  }, [loadFriends, loadRequests]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults(await api.searchUsers(q));
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, api]);

  const knownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of friends ?? []) ids.add(f.user.id);
    for (const r of requests?.incoming ?? []) ids.add(r.user.id);
    for (const r of requests?.outgoing ?? []) ids.add(r.user.id);
    return ids;
  }, [friends, requests]);

  const sendRequest = async (toUserId: string) => {
    setBusyId(toUserId);
    setError(null);
    try {
      await api.sendFriendRequest({ toUserId });
      setQuery("");
      setResults([]);
      await Promise.all([loadFriends(), loadRequests()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const accept = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.acceptFriendRequest(id);
      await Promise.all([loadFriends(), loadRequests()]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.declineFriendRequest(id);
      await loadRequests();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await api.removeFriend(userId);
      if (selected?.id === userId) setSelected(null);
      await loadFriends();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", gap: 16, height: "100%", minHeight: 0 }}>
      <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
        <div className="card" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
          <input
            className="input"
            placeholder="Find people by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results
            .filter((r) => !knownIds.has(r.id))
            .map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>{r.displayName}</span>
                <button
                  className="btn sm"
                  disabled={busyId === r.id}
                  onClick={() => sendRequest(r.id)}
                >
                  Add
                </button>
              </div>
            ))}
        </div>

        {requests && (requests.incoming.length > 0 || requests.outgoing.length > 0) && (
          <div className="card" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
            {requests.incoming.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span>{r.user.displayName}</span>
                <div className="row">
                  <button className="btn sm primary" disabled={busyId === r.id} onClick={() => accept(r.id)}>
                    Accept
                  </button>
                  <button className="btn sm ghost" disabled={busyId === r.id} onClick={() => decline(r.id)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {requests.outgoing.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">{r.user.displayName} (pending)</span>
                <button className="btn sm ghost" disabled={busyId === r.id} onClick={() => decline(r.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 12, gap: 4, display: "flex", flexDirection: "column", flex: 1 }}>
          {!friends ? (
            <div className="muted">Loading…</div>
          ) : friends.length === 0 ? (
            <div className="muted">No friends yet — search above to add one.</div>
          ) : (
            friends.map((f) => (
              <button
                key={f.user.id}
                className="btn ghost"
                style={{
                  justifyContent: "space-between",
                  background: selected?.id === f.user.id ? "var(--surface-2)" : "transparent",
                }}
                onClick={() => setSelected(f.user)}
              >
                <span>{f.user.displayName}</span>
                {f.unreadCount > 0 && <span className="badge">{f.unreadCount}</span>}
              </button>
            ))
          )}
        </div>

        {error && <div className="error">{error}</div>}
      </div>

      <div className="card" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {selected ? (
          <ChatPane
            api={api}
            me={me}
            friend={selected}
            onRemove={() => remove(selected.id)}
          />
        ) : (
          <div className="empty" style={{ margin: "auto" }}>
            Pick a friend to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}

function ChatPane({
  api,
  me,
  friend,
  onRemove,
}: {
  api: ApiClient;
  me: User;
  friend: AuthorRef;
  onRemove: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current = messages ?? [];
  }, [messages]);

  const load = useCallback(async () => {
    try {
      setMessages(await api.listMessages(friend.id, { limit: 50 }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [api, friend.id]);

  useEffect(() => {
    setMessages(null);
    void load();
  }, [friend.id, load]);

  useEffect(() => {
    const t = setInterval(async () => {
      const last = messagesRef.current[messagesRef.current.length - 1];
      try {
        const fresh = await api.listMessages(friend.id, last ? { after: last.createdAt } : { limit: 50 });
        if (fresh.length === 0) return;
        setMessages((prev) => {
          const merged = [...(prev ?? [])];
          for (const m of fresh) {
            const i = merged.findIndex((x) => x.id === m.id);
            if (i >= 0) merged[i] = m;
            else merged.push(m);
          }
          return merged;
        });
      } catch {
        /* transient — retried next tick */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [api, friend.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const msg = await api.sendMessage(friend.id, { body });
      setMessages((prev) => [...(prev ?? []), msg]);
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: 12, borderBottom: "1px solid var(--border)", justifyContent: "space-between" }}>
        <b>{friend.displayName}</b>
        <button className="btn ghost sm" onClick={onRemove}>
          Remove friend
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {!messages ? (
          <div className="muted">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="muted">Say hi 👋</div>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === me.id;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "70%",
                    padding: "6px 10px",
                    borderRadius: 12,
                    fontSize: 13,
                    background: mine ? "linear-gradient(135deg, var(--accent), #5b8cff)" : "var(--surface-2)",
                    color: mine ? "#fff" : "var(--text)",
                  }}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <div className="error" style={{ margin: "0 12px 8px" }}>{error}</div>}

      <div className="row" style={{ padding: 12, borderTop: "1px solid var(--border)" }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={`Message ${friend.displayName}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn primary" disabled={busy || !draft.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- */

function StoreView({
  api,
  apiUrl,
  installed,
}: {
  api: ApiClient;
  apiUrl: string;
  installed: Map<string, InstalledGame>;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const runInstall = async (gameId: string) => {
    setBusyId(gameId);
    setError(null);
    try {
      await window.arcade.install(gameId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listGames({ q: q || undefined, sort: "popular", pageSize: 48 });
      setGames(res.items);
    } catch (err) {
      setError(errorMessage(err));
      setGames([]);
    }
  }, [api, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Store</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ flex: 1, maxWidth: 360 }}
          placeholder="Search games…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button className="btn" onClick={load}>
          Search
        </button>
      </div>

      {error && <div className="error">{error}</div>}
      {!games ? (
        <div className="empty">Loading…</div>
      ) : games.length === 0 ? (
        <div className="empty">No games found.</div>
      ) : (
        <div className="grid">
          {games.map((g) => {
            const inst = installed.get(g.id);
            const isExternal = g.playType === "external";
            const latest = g.currentVersion?.version ?? 0;
            const hasUpdate = Boolean(inst) && latest > (inst?.version ?? 0);
            const busy = busyId === g.id;
            return (
              <div className="card" key={g.id}>
                {g.coverImageUrl ? (
                  <img className="cover" src={g.coverImageUrl} alt="" />
                ) : (
                  <div className="cover">{isExternal ? "🔗" : "🎮"}</div>
                )}
                <div className="body">
                  <h3>{g.title}</h3>
                  <p>{g.summary}</p>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="stat">
                      ★ {g.stats.ratingAvg || "–"} · {g.stats.playCount} plays
                    </span>
                    {g.aiTools[0] && <span className="badge">{g.aiTools[0]}</span>}
                  </div>

                  {hasUpdate && (
                    <p className="stat" style={{ color: "#ffd58a" }}>
                      ⬆ Update available (v{inst?.version} → v{latest})
                    </p>
                  )}

                  <div className="row" style={{ marginTop: 4 }}>
                    {isExternal ? (
                      <button
                        className="btn primary"
                        style={{ flex: 1 }}
                        onClick={() => window.arcade.openExternal(g.externalUrl ?? "")}
                      >
                        Open ↗
                      </button>
                    ) : inst ? (
                      <>
                        <button
                          className="btn primary"
                          style={{ flex: 1 }}
                          onClick={() => window.arcade.launch(g.id)}
                        >
                          ▶ Play
                        </button>
                        {hasUpdate && (
                          <button
                            className="btn"
                            style={{ borderColor: "#7a5a1f", color: "#ffd58a" }}
                            disabled={busy}
                            onClick={() => runInstall(g.id)}
                          >
                            {busy ? "Updating…" : `⬆ Update`}
                          </button>
                        )}
                        <button
                          className="btn ghost sm"
                          onClick={() => window.arcade.uninstall(g.id)}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn primary"
                        style={{ flex: 1 }}
                        disabled={busy}
                        onClick={() => runInstall(g.id)}
                      >
                        {busy ? "Installing…" : "⬇ Install"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="stat" style={{ marginTop: 20 }}>
        Connected to {apiUrl}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- */

function LibraryView({
  library,
  latestVersions,
}: {
  library: InstalledGame[];
  latestVersions: Record<string, number>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = async (gameId: string) => {
    setBusyId(gameId);
    setError(null);
    try {
      await window.arcade.install(gameId); // re-download + re-extract + refresh manifest
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (library.length === 0) {
    return (
      <div>
        <h1>Library</h1>
        <div className="empty">
          Nothing installed yet. Head to the Store and install a game.
        </div>
      </div>
    );
  }

  const outdatedCount = library.filter(
    (g) => (latestVersions[g.gameId] ?? 0) > g.version,
  ).length;

  return (
    <div>
      <h1>Library</h1>
      {outdatedCount > 0 && (
        <div
          className="row"
          style={{
            gap: 10,
            padding: "8px 14px",
            marginBottom: 14,
            borderRadius: 10,
            background: "#2a2010",
            border: "1px solid #7a5a1f",
            color: "#ffd58a",
            fontSize: 13,
          }}
        >
          ⬆ {outdatedCount} game{outdatedCount > 1 ? "s have" : " has"} a newer version available.
        </div>
      )}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="grid">
        {library.map((g) => {
          const latest = latestVersions[g.gameId] ?? 0;
          const hasUpdate = latest > g.version;
          const busy = busyId === g.gameId;
          return (
            <div
              className="card"
              key={g.gameId}
              style={hasUpdate ? { borderColor: "#7a5a1f" } : undefined}
            >
              <div className="cover">🎮</div>
              <div className="body">
                <h3>{g.title}</h3>
                <p className="stat">
                  v{g.version} · {(g.sizeBytes / 1024).toFixed(0)} KB
                  {g.lastPlayedAt
                    ? ` · played ${new Date(g.lastPlayedAt).toLocaleDateString()}`
                    : " · never played"}
                </p>
                {hasUpdate && (
                  <p className="stat" style={{ color: "#ffd58a" }}>
                    ⬆ Newer version available (v{g.version} → v{latest})
                  </p>
                )}
                <div className="row" style={{ marginTop: 4 }}>
                  {hasUpdate ? (
                    <button
                      className="btn primary"
                      style={{ flex: 1, background: "#8a5a12", borderColor: "transparent" }}
                      disabled={busy}
                      onClick={() => update(g.gameId)}
                    >
                      {busy ? "Updating…" : `⬆ Update to v${latest}`}
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      style={{ flex: 1 }}
                      onClick={() => window.arcade.launch(g.gameId)}
                    >
                      ▶ Play
                    </button>
                  )}
                  {hasUpdate && (
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => window.arcade.launch(g.gameId)}
                    >
                      Play old
                    </button>
                  )}
                  <button
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => window.arcade.uninstall(g.gameId)}
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
