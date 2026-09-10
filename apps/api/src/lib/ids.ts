import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** URL-safe lowercase base36-ish random id of the given length. */
export function shortId(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function id(prefix: string): string {
  return `${prefix}_${shortId(14)}`;
}

/** Opaque session token (raw value handed to the client, never stored). */
export function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export { randomUUID };
