export const MAX_NAME = 32;

/** Strip control characters (C0 + DEL), collapse whitespace, cap length. */
export function sanitizeName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}
