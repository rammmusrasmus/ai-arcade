import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CreateGameInput, PlayType } from "@ai-arcade/shared";
import { useAuth } from "../auth";
import { errorMessage } from "../api";
import { ErrorNote } from "../components/primitives";
import { useCreateGame } from "../queries";

export function SubmitPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const create = useCreateGame();

  const [playType, setPlayType] = useState<PlayType>("html");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [aiTools, setAiTools] = useState("Claude");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!loading && !user) {
    return (
      <div className="card p-6 text-center">
        <p>Please <Link to="/login" className="text-[var(--color-accent)]">sign in</Link> to submit a game.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: CreateGameInput = {
      title,
      summary,
      description,
      tags: splitList(tags),
      aiTools: splitList(aiTools),
      playType,
      externalUrl: playType === "external" ? externalUrl : undefined,
    };
    try {
      const game = await create.mutateAsync(input);
      navigate(`/manage/${game.slug}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Submit a game</h1>
        <p className="text-[#9297b3] mt-1">
          Step 1 of 2 — the basics. Next you’ll upload a build (or confirm the link) and send it for
          review.
        </p>
      </div>

      <form onSubmit={submit} className="card p-6 flex flex-col gap-4">
        <div className="flex gap-2">
          {(["html", "external"] as PlayType[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setPlayType(t)}
              className={`btn flex-1 ${playType === t ? "btn-primary" : ""}`}
            >
              {t === "html" ? "Upload HTML build" : "Link to hosted game"}
            </button>
          ))}
        </div>

        <Field label="Title">
          <input className="input" required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Summary" hint="One line shown on cards (10–160 chars)">
          <input className="input" required minLength={10} maxLength={160} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>

        <Field label="Description" hint="Optional. Controls, credits, what makes it fun.">
          <textarea className="textarea" rows={5} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Tags" hint="comma separated">
            <input className="input" placeholder="arcade, puzzle" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="AI tools used" hint="comma separated">
            <input className="input" placeholder="Claude, Midjourney" value={aiTools} onChange={(e) => setAiTools(e.target.value)} />
          </Field>
        </div>

        {playType === "external" && (
          <Field label="Game URL">
            <input
              className="input"
              type="url"
              required
              placeholder="https://…"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
            />
          </Field>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <button className="btn btn-primary self-start" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">
        {label}
        {hint && <span className="text-[#7e849e] font-normal"> — {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
