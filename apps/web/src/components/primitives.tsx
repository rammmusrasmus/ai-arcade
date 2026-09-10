import type { ReactNode } from "react";
import type { GameStatus } from "@ai-arcade/shared";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-[#aeb3cc] py-10 justify-center">
      <span className="w-5 h-5 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="card p-4 border-[#6b2434] bg-[#2a141b] text-[#ffb3c0] text-sm">{children}</div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-semibold text-lg">{title}</p>
      {hint && <p className="text-[#8b90ab] mt-1 text-sm">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<GameStatus, string> = {
  approved: "text-[#7ef0b0] border-[#1f5a3d] bg-[#0f2a1f]",
  pending: "text-[#ffd58a] border-[#5c4a1f] bg-[#2a220f]",
  rejected: "text-[#ffb3c0] border-[#6b2434] bg-[#2a141b]",
  draft: "text-[#b9bed6] border-[var(--color-border)] bg-[var(--color-surface-2)]",
  unpublished: "text-[#b9bed6] border-[var(--color-border)] bg-[var(--color-surface-2)]",
};

export function StatusBadge({ status }: { status: GameStatus }) {
  return <span className={`badge ${STATUS_STYLE[status]}`}>{status}</span>;
}

export function Stars({ value, count }: { value: number; count: number }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1 text-sm text-[#ffd166]" title={`${value} / 5`}>
      {"★★★★★".slice(0, full)}
      <span className="text-[#565b74]">{"★★★★★".slice(full)}</span>
      <span className="text-[#8b90ab] ml-1">{count > 0 ? `(${count})` : "unrated"}</span>
    </span>
  );
}
