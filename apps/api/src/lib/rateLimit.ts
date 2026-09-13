import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// occasional sweep so the map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 60_000).unref?.();

/**
 * Fixed-window in-memory limiter. Fine for a single instance; swap for
 * @fastify/rate-limit + Redis if this ever runs multi-node.
 *
 * Keys by the authenticated user when there is one, else by IP.
 */
/** Raw bucket check, keyed however the caller likes — e.g. by email instead of user/IP. */
export function checkRateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    const retry = Math.ceil((b.resetAt - now) / 1000);
    throw new AppError(429, "rate_limited", `Too many attempts. Try again in ${retry}s.`);
  }
}

export function rateLimit(name: string, max: number, windowMs: number) {
  return async (req: FastifyRequest) => {
    const who = req.user?.id ?? req.ip;
    checkRateLimit(`${name}:${who}`, max, windowMs);
  };
}
