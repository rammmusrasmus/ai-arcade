import { shortId } from "./ids.js";

// Strip combining diacritical marks (U+0300–U+036F) after NFKD normalization.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "gu");

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

/**
 * Turn a title into a slug and guarantee uniqueness via `exists`.
 * Falls back to a random suffix.
 */
export async function uniqueSlug(
  title: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(title) || "game";
  if (!(await exists(base))) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${shortId(6)}`;
}
