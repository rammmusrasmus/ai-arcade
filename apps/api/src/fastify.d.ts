import type { UserRow } from "./db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The authenticated user, or null for anonymous requests. */
    user: UserRow | null;
  }
}

export {};
