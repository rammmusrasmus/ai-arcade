import { and, asc, desc, eq, gt, inArray, like, lt, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { SendFriendRequestInput, SendMessageInput, type AuthorRef } from "@ai-arcade/shared";
import { requireUser } from "../auth/index.js";
import { db } from "../db/index.js";
import { friendships, messages, users, type FriendshipRow, type UserRow } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { id } from "../lib/ids.js";
import { rateLimit } from "../lib/rateLimit.js";
import { toAuthorRef } from "../serializers.js";

/** Sorted, order-independent key for the pair of users in a conversation. */
function conversationKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/** The other participant's id in a friendship row, from `me`'s point of view. */
function otherUserId(row: FriendshipRow, me: string): string {
  return row.requesterId === me ? row.addresseeId : row.requesterId;
}

async function findFriendship(userA: string, userB: string): Promise<FriendshipRow | undefined> {
  return db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, userA), eq(friendships.addresseeId, userB)),
        and(eq(friendships.requesterId, userB), eq(friendships.addresseeId, userA)),
      ),
    )
    .get();
}

export async function friendRoutes(app: FastifyInstance) {
  /* ---------------- find people to add ---------------- */

  app.get(
    "/users/search",
    { preHandler: rateLimit("user-search", 30, 60_000) },
    async (req) => {
      const me = requireUser(req);
      const q = String((req.query as Record<string, unknown>)?.q ?? "").trim();
      if (q.length < 2) return [] as AuthorRef[];

      const rows = await db
        .select()
        .from(users)
        .where(and(like(sql`lower(${users.displayName})`, `%${q.toLowerCase()}%`), ne(users.id, me.id)))
        .limit(20);
      return rows.map(toAuthorRef);
    },
  );

  /* ---------------- friend list ---------------- */

  app.get("/friends", async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)),
        ),
      );
    if (rows.length === 0) return [];

    const otherIds = rows.map((r) => otherUserId(r, me.id));
    const others = await db.select().from(users).where(inArray(users.id, otherIds));
    const byId = new Map(others.map((u) => [u.id, u] as const));

    const unread = await db
      .select({ conversationKey: messages.conversationKey, n: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.recipientId, me.id), sql`${messages.readAt} is null`))
      .groupBy(messages.conversationKey);
    const unreadByKey = new Map(unread.map((u) => [u.conversationKey, u.n]));

    return rows
      .map((r) => {
        const other = byId.get(otherUserId(r, me.id));
        if (!other) return null;
        return {
          user: toAuthorRef(other),
          friendsSince: new Date(r.respondedAt ?? r.createdAt).toISOString(),
          unreadCount: unreadByKey.get(conversationKey(me.id, other.id)) ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  });

  app.get("/friends/requests", async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "pending"),
          or(eq(friendships.requesterId, me.id), eq(friendships.addresseeId, me.id)),
        ),
      );
    if (rows.length === 0) return { incoming: [], outgoing: [] };

    const otherIds = rows.map((r) => otherUserId(r, me.id));
    const others = await db.select().from(users).where(inArray(users.id, otherIds));
    const byId = new Map(others.map((u) => [u.id, u] as const));

    const shaped = rows
      .map((r) => {
        const other = byId.get(otherUserId(r, me.id));
        if (!other) return null;
        return {
          id: r.id,
          status: r.status,
          outgoing: r.requesterId === me.id,
          user: toAuthorRef(other),
          createdAt: new Date(r.createdAt).toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      incoming: shaped.filter((r) => !r.outgoing),
      outgoing: shaped.filter((r) => r.outgoing),
    };
  });

  app.post(
    "/friends/requests",
    { preHandler: rateLimit("friend-request", 20, 60 * 60_000) },
    async (req, reply) => {
      const me = requireUser(req);
      const { toUserId } = SendFriendRequestInput.parse(req.body);
      if (toUserId === me.id) throw badRequest("You can't add yourself as a friend");

      const target = await db.select().from(users).where(eq(users.id, toUserId)).get();
      if (!target) throw notFound("No such user");

      const existing = await findFriendship(me.id, toUserId);
      if (existing?.status === "accepted") throw conflict("You're already friends");
      if (existing?.status === "pending") {
        if (existing.requesterId === me.id) throw conflict("Friend request already sent");
        // They'd already asked us — the second request just completes it.
        const respondedAt = Date.now();
        await db
          .update(friendships)
          .set({ status: "accepted", respondedAt })
          .where(eq(friendships.id, existing.id));
        reply.status(200);
        return { user: toAuthorRef(target), friendsSince: new Date(respondedAt).toISOString() };
      }

      const row = {
        id: id("freq"),
        requesterId: me.id,
        addresseeId: toUserId,
        status: "pending" as const,
        createdAt: Date.now(),
        respondedAt: null,
      };
      await db.insert(friendships).values(row);
      reply.status(201);
      return {
        id: row.id,
        status: row.status,
        outgoing: true,
        user: toAuthorRef(target),
        createdAt: new Date(row.createdAt).toISOString(),
      };
    },
  );

  app.post("/friends/requests/:id/accept", async (req) => {
    const me = requireUser(req);
    const { id: reqId } = req.params as { id: string };
    const row = await db.select().from(friendships).where(eq(friendships.id, reqId)).get();
    if (!row || row.status !== "pending" || row.addresseeId !== me.id) {
      throw notFound("No such friend request");
    }
    const respondedAt = Date.now();
    await db.update(friendships).set({ status: "accepted", respondedAt }).where(eq(friendships.id, row.id));
    const other = await db.select().from(users).where(eq(users.id, row.requesterId)).get();
    return { user: toAuthorRef(other!), friendsSince: new Date(respondedAt).toISOString() };
  });

  app.post("/friends/requests/:id/decline", async (req) => {
    const me = requireUser(req);
    const { id: reqId } = req.params as { id: string };
    const row = await db.select().from(friendships).where(eq(friendships.id, reqId)).get();
    const allowed = row && row.status === "pending" && (row.addresseeId === me.id || row.requesterId === me.id);
    if (!allowed) throw notFound("No such friend request");
    await db.delete(friendships).where(eq(friendships.id, row.id));
    return { ok: true as const };
  });

  app.delete("/friends/:userId", async (req) => {
    const me = requireUser(req);
    const { userId } = req.params as { userId: string };
    const row = await findFriendship(me.id, userId);
    if (!row || row.status !== "accepted") throw notFound("Not friends with that user");
    await db.delete(friendships).where(eq(friendships.id, row.id));
    return { ok: true as const };
  });

  /* ---------------- direct messages (friends only) ---------------- */

  async function requireFriend(me: UserRow, otherId: string): Promise<void> {
    const row = await findFriendship(me.id, otherId);
    if (!row || row.status !== "accepted") throw forbidden("You can only message friends");
  }

  app.get("/messages/:friendUserId", async (req) => {
    const me = requireUser(req);
    const { friendUserId } = req.params as { friendUserId: string };
    await requireFriend(me, friendUserId);

    const q = req.query as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const key = conversationKey(me.id, friendUserId);

    let rows;
    if (typeof q.after === "string" && q.after) {
      const after = new Date(q.after).getTime();
      rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationKey, key), gt(messages.createdAt, after)))
        .orderBy(asc(messages.createdAt))
        .limit(limit);
    } else if (typeof q.before === "string" && q.before) {
      const before = new Date(q.before).getTime();
      rows = (
        await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationKey, key), lt(messages.createdAt, before)))
          .orderBy(desc(messages.createdAt))
          .limit(limit)
      ).reverse();
    } else {
      rows = (
        await db
          .select()
          .from(messages)
          .where(eq(messages.conversationKey, key))
          .orderBy(desc(messages.createdAt))
          .limit(limit)
      ).reverse();
    }

    // Opening/polling a conversation marks the other person's messages as read.
    const now = Date.now();
    const unreadIds = rows.filter((m) => m.recipientId === me.id && m.readAt == null).map((m) => m.id);
    if (unreadIds.length > 0) {
      await db.update(messages).set({ readAt: now }).where(inArray(messages.id, unreadIds));
    }
    const unreadSet = new Set(unreadIds);

    return rows.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      recipientId: m.recipientId,
      body: m.body,
      createdAt: new Date(m.createdAt).toISOString(),
      readAt: unreadSet.has(m.id) ? new Date(now).toISOString() : m.readAt ? new Date(m.readAt).toISOString() : null,
    }));
  });

  app.post(
    "/messages/:friendUserId",
    { preHandler: rateLimit("send-message", 60, 60_000) },
    async (req, reply) => {
      const me = requireUser(req);
      const { friendUserId } = req.params as { friendUserId: string };
      await requireFriend(me, friendUserId);
      const { body } = SendMessageInput.parse(req.body);

      const row = {
        id: id("msg"),
        conversationKey: conversationKey(me.id, friendUserId),
        senderId: me.id,
        recipientId: friendUserId,
        body,
        createdAt: Date.now(),
        readAt: null,
      };
      await db.insert(messages).values(row);
      reply.status(201);
      return {
        id: row.id,
        senderId: row.senderId,
        recipientId: row.recipientId,
        body: row.body,
        createdAt: new Date(row.createdAt).toISOString(),
        readAt: null,
      };
    },
  );
}
