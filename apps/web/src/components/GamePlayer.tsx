import { useEffect, useRef, useState } from "react";
import { api, API_URL, errorMessage } from "../api";

/** Rewrite an absolute API file URL to a same-origin path (served via Vite/CDN proxy). */
function sameOrigin(url: string): string {
  if (url.startsWith(API_URL + "/files/")) return url.slice(API_URL.length);
  return url;
}

/**
 * Plays an HTML game inside a locked-down iframe.
 *
 * The `sandbox` attribute intentionally omits `allow-same-origin`, so the game
 * runs in an opaque origin and cannot touch the API's cookies or DOM. The API
 * additionally sends `Content-Security-Policy: sandbox` on the game document.
 *
 * Lockstep multiplayer games get the relay endpoint two ways: as an
 * `?arcade_mp=` query param on the URL, and via a `postMessage` once the frame
 * loads (`{ type: "arcade:mp", url, game }`).
 */
export function GamePlayer({ slug, title }: { slug: string; title: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "html"; url: string; mpUrl: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setState({ kind: "idle" });
  }, [slug]);

  async function launch() {
    setState({ kind: "loading" });
    try {
      const res = await api.play(slug);
      if (res.playType === "external") {
        window.open(res.url, "_blank", "noopener,noreferrer");
        setState({ kind: "idle" });
      } else {
        setState({ kind: "html", url: sameOrigin(res.url), mpUrl: res.mpUrl });
      }
    } catch (err) {
      setState({ kind: "error", message: errorMessage(err) });
    }
  }

  if (state.kind === "html") {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] text-sm">
          <span className="text-[#9297b3]">Playing: {title}</span>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => frameRef.current?.requestFullscreen?.()}
            >
              Fullscreen
            </button>
            <button className="btn btn-ghost" onClick={() => setState({ kind: "idle" })}>
              Close
            </button>
          </div>
        </div>
        <iframe
          ref={frameRef}
          src={state.url}
          title={title}
          className="w-full bg-black"
          style={{ height: "min(75vh, 720px)" }}
          sandbox="allow-scripts allow-pointer-lock allow-downloads allow-modals"
          allow="fullscreen; gamepad; autoplay"
          onLoad={() => {
            if (!state.mpUrl) return;
            frameRef.current?.contentWindow?.postMessage(
              { type: "arcade:mp", url: state.mpUrl, game: slug },
              "*",
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="card p-6 flex flex-col items-center gap-3 text-center">
      <p className="text-[#9297b3] text-sm max-w-md">
        Games run in a sandboxed frame with no access to your account.
      </p>
      <button className="btn btn-primary text-base px-6 py-3" onClick={launch} disabled={state.kind === "loading"}>
        {state.kind === "loading" ? "Starting…" : "▶  Play now"}
      </button>
      {state.kind === "error" && <p className="text-[#ffb3c0] text-sm">{state.message}</p>}
    </div>
  );
}
