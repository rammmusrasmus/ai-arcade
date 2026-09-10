import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { shortId } from "../lib/ids.js";
import { sanitizeName } from "./util.js";

/**
 * Lockstep multiplayer relay.
 *
 * The server is a **dumb relay plus a lobby**. It never simulates the game,
 * never validates orders, and never rewrites relayed frames. It only:
 *   - runs the lobby (create / list / join / leave / start)
 *   - deals the match parameters on start (seed, races, humans, slot, names)
 *   - forwards `ord` and `hash` frames verbatim to the OTHER members of a match
 *
 * See docs/multiplayer.md for the wire protocol.
 */

type Mode = "1v1" | "2v2";
const CAPACITY: Record<Mode, number> = { "1v1": 2, "2v2": 4 };
const RACES = ["humans", "orcs", "undead"] as const;

interface Peer {
  id: string;
  name: string;
  /** Optional game scope (slug/id). A peer only sees lobbies with the same scope. */
  game: string | null;
  socket: WebSocket;
  lobbyId: string | null;
  alive: boolean;
  /** When set (authenticated), overrides any client-supplied name. */
  lockedName: string | null;
}

interface Slot {
  peerId: string | null; // null => AI or a human who has left
  name: string;
  race: string;
  human: boolean;
}

interface Lobby {
  id: string;
  name: string;
  mode: Mode;
  game: string | null;
  hostId: string;
  started: boolean;
  /** Pre-start roster (peer ids in join order). */
  members: string[];
  /** Frozen roster once the match starts. Index === slot. */
  slots: Slot[] | null;
  seed: number | null;
  createdAt: number;
}

export interface RelayOptions {
  path: string;
  maxLobbies: number;
  /** Resolve a session token to a display name (optional auth). */
  resolveUser?: (token: string) => Promise<{ displayName: string } | null>;
}

export class MultiplayerRelay {
  private readonly wss: WebSocketServer;
  private readonly peers = new Map<string, Peer>();
  private readonly lobbies = new Map<string, Lobby>();
  private readonly opts: RelayOptions;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(server: HttpServer, opts: RelayOptions) {
    this.opts = opts;
    // No `verifyClient` => any Origin is accepted, including `Origin: null`
    // from sandboxed game frames. That is intentional and required.
    this.wss = new WebSocketServer({ server, path: opts.path, perMessageDeflate: false });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));

    this.heartbeat = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (!peer.alive) {
          peer.socket.terminate();
          continue;
        }
        peer.alive = false;
        try {
          peer.socket.ping();
        } catch {
          /* ignore */
        }
      }
    }, 30_000);
    this.heartbeat.unref?.();
  }

  get stats() {
    return {
      peers: this.peers.size,
      lobbies: this.lobbies.size,
      matches: [...this.lobbies.values()].filter((l) => l.started).length,
    };
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const peer of this.peers.values()) {
      try {
        peer.socket.close(1001, "server shutting down");
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  /* ----------------------------------------------------------------- */

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    // Turns are 100ms — never let Nagle batch a relayed frame.
    try {
      req.socket.setNoDelay(true);
    } catch {
      /* ignore */
    }

    const peer: Peer = {
      id: shortId(10),
      name: `Guest-${shortId(4)}`,
      game: null,
      socket: ws,
      lobbyId: null,
      alive: true,
      lockedName: null,
    };
    this.peers.set(peer.id, peer);

    // Optional token auth via ?token= on the handshake URL.
    const token = this.tokenFromUrl(req.url);
    if (token && this.opts.resolveUser) {
      this.opts
        .resolveUser(token)
        .then((u) => {
          if (u) {
            peer.lockedName = sanitizeName(u.displayName);
            peer.name = peer.lockedName;
          }
        })
        .catch(() => undefined);
    }

    ws.on("pong", () => {
      peer.alive = true;
    });
    ws.on("message", (data) => this.onMessage(peer, data));
    ws.on("close", () => this.onClose(peer));
    ws.on("error", () => {
      /* close handler does the cleanup */
    });
  }

  private onMessage(peer: Peer, data: RawData) {
    const text = typeof data === "string" ? data : data.toString("utf8");

    // Fast path: relayed frames are forwarded byte-for-byte, no re-encoding.
    if (text.startsWith('{"t":"ord"') || text.startsWith('{"t":"hash"')) {
      this.relay(peer, text);
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.send(peer, { t: "err", msg: "invalid JSON" });
      return;
    }

    try {
      switch (msg.t) {
        case "hello":
          return this.onHello(peer, msg);
        case "list":
          return this.send(peer, { t: "lobbies", lobbies: this.lobbyList(peer.game) });
        case "create":
          return this.onCreate(peer, msg);
        case "join":
          return this.onJoin(peer, msg);
        case "leave":
          this.leaveLobby(peer);
          return this.send(peer, { t: "lobbies", lobbies: this.lobbyList(peer.game) });
        case "start":
          return this.onStart(peer);
        case "ord":
        case "hash":
          return this.relay(peer, text);
        case "ping":
          return this.send(peer, { t: "pong" });
        default:
          return this.send(peer, { t: "err", msg: `unknown message type: ${String(msg.t)}` });
      }
    } catch (err) {
      this.send(peer, { t: "err", msg: err instanceof Error ? err.message : "error" });
    }
  }

  /* ---------------- lobby control ---------------- */

  private onHello(peer: Peer, msg: Record<string, unknown>) {
    if (!peer.lockedName && typeof msg.name === "string") {
      const clean = sanitizeName(msg.name);
      if (clean) peer.name = clean;
    }
    if (typeof msg.game === "string") peer.game = msg.game.slice(0, 64) || null;
    this.send(peer, { t: "hello", id: peer.id, name: peer.name });
  }

  private onCreate(peer: Peer, msg: Record<string, unknown>) {
    const mode = msg.mode === "2v2" ? "2v2" : msg.mode === "1v1" ? "1v1" : null;
    if (!mode) return this.send(peer, { t: "err", msg: "mode must be '1v1' or '2v2'" });
    if (this.lobbies.size >= this.opts.maxLobbies) {
      return this.send(peer, { t: "err", msg: "server is at capacity, try again shortly" });
    }
    if (peer.lobbyId) this.leaveLobby(peer);

    const lobby: Lobby = {
      id: shortId(6),
      name: sanitizeName(typeof msg.name === "string" ? msg.name : "") || `${peer.name}'s game`,
      mode,
      game: peer.game,
      hostId: peer.id,
      started: false,
      members: [peer.id],
      slots: null,
      seed: null,
      createdAt: Date.now(),
    };
    this.lobbies.set(lobby.id, lobby);
    peer.lobbyId = lobby.id;

    this.send(peer, this.lobbyView(lobby, peer));
    this.broadcastLobbies(lobby.game);
  }

  private onJoin(peer: Peer, msg: Record<string, unknown>) {
    const lobby = typeof msg.id === "string" ? this.lobbies.get(msg.id) : undefined;
    if (!lobby) return this.send(peer, { t: "err", msg: "no such lobby" });
    if (lobby.started) return this.send(peer, { t: "err", msg: "match already started" });
    if (lobby.members.length >= CAPACITY[lobby.mode]) {
      return this.send(peer, { t: "err", msg: "lobby is full" });
    }
    if (peer.lobbyId === lobby.id) return this.send(peer, this.lobbyView(lobby, peer));
    if (peer.lobbyId) this.leaveLobby(peer);

    lobby.members.push(peer.id);
    peer.lobbyId = lobby.id;
    this.sendLobbyToAll(lobby);
    this.broadcastLobbies(lobby.game);
  }

  private onStart(peer: Peer) {
    const lobby = peer.lobbyId ? this.lobbies.get(peer.lobbyId) : undefined;
    if (!lobby) return this.send(peer, { t: "err", msg: "you are not in a lobby" });
    if (lobby.hostId !== peer.id) {
      return this.send(peer, { t: "err", msg: "only the host can start the match" });
    }
    if (lobby.started) return this.send(peer, { t: "err", msg: "match already started" });

    const cap = CAPACITY[lobby.mode];
    const roster = lobby.members.slice(0, cap);
    const seed = (Math.random() * 0x100000000) >>> 0;

    const slots: Slot[] = [];
    for (let i = 0; i < cap; i++) {
      const memberId = roster[i] ?? null;
      const member = memberId ? this.peers.get(memberId) : undefined;
      const human = Boolean(member);
      const race = RACES[(Math.random() * RACES.length) | 0]!;
      slots.push({
        peerId: human ? memberId : null,
        name: member ? member.name : `AI (${race})`,
        race,
        human,
      });
    }

    lobby.slots = slots;
    lobby.seed = seed;
    lobby.started = true;

    const races = slots.map((s) => s.race);
    const humans = slots.map((s) => s.human);
    const names = slots.map((s) => s.name);

    slots.forEach((slot, index) => {
      if (!slot.peerId) return;
      const p = this.peers.get(slot.peerId);
      if (p) {
        this.send(p, { t: "start", seed, slot: index, races, humans, mode: lobby.mode, names });
      }
    });

    this.broadcastLobbies(lobby.game);
  }

  /* ---------------- match relay ---------------- */

  /** Forward a raw `ord` / `hash` frame to the OTHER connected members. Verbatim. */
  private relay(peer: Peer, rawText: string) {
    const lobby = peer.lobbyId ? this.lobbies.get(peer.lobbyId) : undefined;
    if (!lobby || !lobby.started || !lobby.slots) return;
    for (const slot of lobby.slots) {
      if (!slot.peerId || slot.peerId === peer.id) continue;
      const target = this.peers.get(slot.peerId);
      if (target && target.socket.readyState === WebSocket.OPEN) {
        target.socket.send(rawText);
      }
    }
  }

  /* ---------------- leaving / disconnect ---------------- */

  private onClose(peer: Peer) {
    this.leaveLobby(peer);
    this.peers.delete(peer.id);
  }

  private leaveLobby(peer: Peer) {
    const lobby = peer.lobbyId ? this.lobbies.get(peer.lobbyId) : undefined;
    peer.lobbyId = null;
    if (!lobby) return;

    if (lobby.started && lobby.slots) {
      const idx = lobby.slots.findIndex((s) => s.peerId === peer.id);
      if (idx !== -1) {
        lobby.slots[idx]!.peerId = null;
        // `slot` is REQUIRED here — the survivor drops that slot from the set
        // of players it waits on, otherwise the match hangs forever.
        for (const slot of lobby.slots) {
          if (!slot.peerId) continue;
          const other = this.peers.get(slot.peerId);
          if (other) this.send(other, { t: "peerLeft", name: peer.name, slot: idx });
        }
      }
      if (lobby.slots.every((s) => !s.peerId)) this.lobbies.delete(lobby.id);
    } else {
      lobby.members = lobby.members.filter((id) => id !== peer.id);
      if (lobby.members.length === 0) {
        this.lobbies.delete(lobby.id);
      } else {
        if (lobby.hostId === peer.id) lobby.hostId = lobby.members[0]!;
        this.sendLobbyToAll(lobby);
      }
    }
    this.broadcastLobbies(lobby.game);
  }

  /* ---------------- views / fan-out ---------------- */

  private lobbyView(lobby: Lobby, peer: Peer) {
    const you = lobby.started
      ? (lobby.slots?.findIndex((s) => s.peerId === peer.id) ?? -1)
      : lobby.members.indexOf(peer.id);
    return {
      t: "lobby" as const,
      lobby: this.publicLobby(lobby),
      you,
      host: lobby.hostId === peer.id,
    };
  }

  private publicLobby(lobby: Lobby) {
    return {
      id: lobby.id,
      name: lobby.name,
      mode: lobby.mode,
      game: lobby.game,
      started: lobby.started,
      players: lobby.started
        ? (lobby.slots?.filter((s) => s.peerId).length ?? 0)
        : lobby.members.length,
      capacity: CAPACITY[lobby.mode],
      host: this.peers.get(lobby.hostId)?.name ?? "—",
    };
  }

  private lobbyList(scope: string | null) {
    return [...this.lobbies.values()]
      .filter((l) => l.game === scope)
      .map((l) => this.publicLobby(l));
  }

  private sendLobbyToAll(lobby: Lobby) {
    const ids = lobby.started
      ? (lobby.slots?.map((s) => s.peerId).filter(Boolean) as string[])
      : lobby.members;
    for (const id of ids) {
      const p = this.peers.get(id);
      if (p) this.send(p, this.lobbyView(lobby, p));
    }
  }

  private broadcastLobbies(scope: string | null) {
    const list = this.lobbyList(scope);
    for (const peer of this.peers.values()) {
      if (peer.lobbyId === null && peer.game === scope) {
        this.send(peer, { t: "lobbies", lobbies: list });
      }
    }
  }

  /* ---------------- low-level ---------------- */

  private send(peer: Peer, obj: unknown) {
    if (peer.socket.readyState === WebSocket.OPEN) {
      peer.socket.send(JSON.stringify(obj));
    }
  }

  private tokenFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    const q = url.indexOf("?");
    if (q === -1) return null;
    return new URLSearchParams(url.slice(q + 1)).get("token");
  }
}
