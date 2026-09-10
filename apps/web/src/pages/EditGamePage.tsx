import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorNote, Spinner, StatusBadge } from "../components/primitives";
import {
  useGame,
  useGameVersions,
  useSetMedia,
  useSubmitForReview,
  useUnpublish,
  useUpdateGame,
  useUploadVersion,
} from "../queries";

export function EditGamePage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const game = useGame(slug);
  const versions = useGameVersions(game.data?.id);

  const update = useUpdateGame(slug ?? "");
  const uploadVersion = useUploadVersion(slug ?? "");
  const submit = useSubmitForReview(slug ?? "");
  const unpublish = useUnpublish(slug ?? "");
  const setMedia = useSetMedia(slug ?? "");

  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [changelog, setChangelog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (game.isLoading) return <Spinner />;
  if (game.isError || !game.data) return <ErrorNote>Game not found.</ErrorNote>;

  const g = game.data;
  if (user && user.id !== g.author.id && user.role === "user") {
    return <ErrorNote>You don’t have access to manage this game.</ErrorNote>;
  }

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">{g.title}</h1>
        <StatusBadge status={g.status} />
        <Link to={`/games/${g.slug}`} className="btn btn-ghost ml-auto">
          View page
        </Link>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && (
        <div className="card p-3 text-sm text-[#7ef0b0] border-[#1f5a3d] bg-[#0f2a1f]">{notice}</div>
      )}

      {/* --- status / submit --- */}
      <section className="card p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Review status</h2>
        <p className="text-sm text-[#9297b3]">
          {g.status === "draft" && "This game is a draft. Send it for review when it’s ready."}
          {g.status === "pending" && "In the moderation queue. You’ll see the result here."}
          {g.status === "approved" && "Live in the store. Uploading a new build re-enters review."}
          {g.status === "rejected" && "A moderator asked for changes. Update and resubmit."}
          {g.status === "unpublished" && "Currently hidden from the store."}
        </p>
        <div className="flex gap-2">
          {(g.status === "draft" || g.status === "rejected" || g.status === "unpublished") && (
            <button
              className="btn btn-primary"
              disabled={submit.isPending}
              onClick={() => run(() => submit.mutateAsync(""), "Submitted for review.")}
            >
              Submit for review
            </button>
          )}
          {(g.status === "approved" || g.status === "pending") && (
            <button
              className="btn btn-danger"
              disabled={unpublish.isPending}
              onClick={() => run(() => unpublish.mutateAsync(), "Taken down.")}
            >
              Take down
            </button>
          )}
        </div>
      </section>

      {/* --- build / link --- */}
      {g.playType === "html" ? (
        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Game build</h2>
          <p className="text-sm text-[#9297b3]">
            Upload a <code>.zip</code> containing <code>index.html</code> at its root plus assets.
            Max 50&nbsp;MB.
          </p>
          <input ref={fileRef} type="file" accept=".zip,application/zip" className="input" />
          <input
            className="input"
            placeholder="Changelog (optional)"
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
          />
          <button
            className="btn btn-primary self-start"
            disabled={uploadVersion.isPending}
            onClick={() => {
              const file = fileRef.current?.files?.[0];
              if (!file) {
                setError("Choose a .zip file first");
                return;
              }
              run(
                () => uploadVersion.mutateAsync({ bundle: file, changelog }),
                "Build uploaded — it will be reviewed.",
              );
            }}
          >
            {uploadVersion.isPending ? "Uploading…" : "Upload build"}
          </button>

          {uploadVersion.data && uploadVersion.data.externalRefs.length > 0 && (
            <div className="card p-3 border-[#5c4a1f] bg-[#2a220f] text-[#ffd58a] text-sm">
              <p className="font-semibold">
                ⚠ This build requests {uploadVersion.data.externalRefs.length} external URL
                {uploadVersion.data.externalRefs.length === 1 ? "" : "s"}
              </p>
              <p className="text-[#c9b98a] mt-1">
                The <b>desktop client blocks all outside network access</b>, so these won’t load
                there (they’re fine in the browser player). Bundle every script, font and image
                inside the zip.
              </p>
              <ul className="mt-2 font-mono text-xs break-all list-disc pl-5">
                {uploadVersion.data.externalRefs.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {versions.data && versions.data.length > 0 && (
            <table className="text-sm mt-2 w-full">
              <thead className="text-[#7e849e] text-left">
                <tr>
                  <th className="py-1">Ver</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Files</th>
                  <th>Ext</th>
                  <th>Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {versions.data.map((v) => (
                  <tr key={v.id} className="border-t border-[var(--color-border)]">
                    <td className="py-1.5">v{v.version}</td>
                    <td>{v.status}</td>
                    <td>{v.bundleBytes ? `${(v.bundleBytes / 1024).toFixed(0)} KB` : "—"}</td>
                    <td>{v.fileCount ?? "—"}</td>
                    <td>
                      {v.externalRefs.length > 0 ? (
                        <span
                          className="text-[#ffd58a]"
                          title={v.externalRefs.join("\n")}
                        >
                          ⚠ {v.externalRefs.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{new Date(v.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-semibold">Hosted URL</h2>
          <ExternalUrlEditor
            initial={g.externalUrl ?? ""}
            onSave={(externalUrl) => run(() => update.mutateAsync({ externalUrl }), "Saved.")}
            saving={update.isPending}
          />
        </section>
      )}

      {/* --- metadata --- */}
      <MetadataEditor
        key={g.updatedAt}
        game={g}
        saving={update.isPending}
        onSave={(patch) => run(() => update.mutateAsync(patch), "Saved.")}
      />

      {/* --- cover image --- */}
      <section className="card p-5 flex flex-col gap-3">
        <h2 className="font-semibold">Cover image</h2>
        <div className="flex items-center gap-4">
          <div className="w-40 aspect-[16/10] rounded-lg bg-[var(--color-surface-2)] overflow-hidden grid place-items-center">
            {g.coverImageUrl ? (
              <img src={g.coverImageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="opacity-40 text-3xl">🎮</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input ref={coverRef} type="file" accept="image/*" className="input" />
            <button
              className="btn"
              disabled={setMedia.isPending}
              onClick={async () => {
                const file = coverRef.current?.files?.[0];
                if (!file) {
                  setError("Choose an image first");
                  return;
                }
                run(async () => {
                  const { url } = await api.uploadImage(file);
                  await setMedia.mutateAsync({ coverImageUrl: url });
                }, "Cover updated.");
              }}
            >
              Upload cover
            </button>
            {g.coverImageUrl && (
              <button
                className="btn btn-ghost"
                onClick={() => run(() => setMedia.mutateAsync({ coverImageUrl: null }), "Cover removed.")}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ExternalUrlEditor({
  initial,
  onSave,
  saving,
}: {
  initial: string;
  onSave: (url: string) => void;
  saving: boolean;
}) {
  const [url, setUrl] = useState(initial);
  return (
    <div className="flex gap-2">
      <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn btn-primary" disabled={saving} onClick={() => onSave(url)}>
        Save
      </button>
    </div>
  );
}

function MetadataEditor({
  game,
  onSave,
  saving,
}: {
  game: { title: string; summary: string; description: string; tags: string[]; aiTools: string[] };
  onSave: (patch: {
    title: string;
    summary: string;
    description: string;
    tags: string[];
    aiTools: string[];
  }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(game.summary);
  const [description, setDescription] = useState(game.description);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [aiTools, setAiTools] = useState(game.aiTools.join(", "));

  return (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Details</h2>
      <label className="flex flex-col gap-1 text-sm">
        Title
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Summary
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          className="textarea"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Tags
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          AI tools
          <input className="input" value={aiTools} onChange={(e) => setAiTools(e.target.value)} />
        </label>
      </div>
      <button
        className="btn btn-primary self-start"
        disabled={saving}
        onClick={() =>
          onSave({
            title,
            summary,
            description,
            tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
            aiTools: aiTools.split(",").map((s) => s.trim()).filter(Boolean),
          })
        }
      >
        Save details
      </button>
    </section>
  );
}
