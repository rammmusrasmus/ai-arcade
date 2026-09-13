import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiClient, PlayType } from "@ai-arcade/shared";
import type { Game, User } from "@ai-arcade/shared";
import type { InstalledGame, PickedBundle, UpdateState } from "../../preload/index";
import { errorMessage, makeApi, setToken } from "./api";

function b64ToBlob(b64: string, type = "application/zip"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

type Tab = "store" | "library" | "review";

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
        <AccountControl api={api} user={user} apiUrl={apiUrl} onChange={() => refreshSession(api)} />
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
          <ReviewView api={api} apiUrl={apiUrl} />
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

function ReviewView({ api, apiUrl }: { api: ApiClient; apiUrl: string }) {
  const [queue, setQueue] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

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
                <div className="row">
                  <button
                    className="btn ghost sm"
                    onClick={() => window.arcade.openExternal(`${apiUrl}/games/${g.slug}`)}
                  >
                    Open in browser ↗
                  </button>
                </div>
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
  apiUrl,
  onChange,
}: {
  api: ApiClient;
  user: User | null;
  apiUrl: string;
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
          {challenge ? (
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
                  onClick={() => window.arcade.openExternal(`${apiUrl}/forgot-password`)}
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
            </>
          ) : (
            <div className="stat">Password sign-in is disabled on this server.</div>
          )}

          {!challenge && providers.devLogin && (
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
