# Multiplayer relay

AI Arcade ships a **lockstep multiplayer relay** for games whose simulation is
deterministic (same seed + same ordered inputs → identical match on every machine).
Games like this never send state over the wire — only player orders — so the platform
only needs to be a **dumb relay plus a lobby**.

The relay:

- **does not** simulate the game, hold game state, or validate orders
- **does not** rewrite, reorder, throttle, or re-stamp relayed frames
- **does** run the lobby and deal the match parameters (seed, races, humans, slot)
- **does** forward `ord` / `hash` frames **verbatim** to the *other* members of a match

Anti-cheat, if you want it later, belongs in comparing the `hash` fingerprints clients
already exchange — not in the server having an opinion about a move.

## Endpoint

```
ws://<api-host>/mp          # dev:  ws://127.0.0.1:4000/mp
wss://<api-host>/mp         # prod: scheme follows PUBLIC_API_URL
```

Configured by `MULTIPLAYER_ENABLED`, `MP_PATH`, `MP_MAX_LOBBIES`, `PUBLIC_WS_URL` in `.env`.
`GET /mp/status` returns `{ enabled, path, url, peers, lobbies, matches }`.

Optional auth: append `?token=<session token>` to the WebSocket URL. If it resolves to a
user, that account's display name is used and any client-supplied `name` is ignored.

**`Origin: null` is accepted.** Games run in a sandboxed frame (`Content-Security-Policy:
sandbox` → opaque origin), which sends `Origin: null` on the WS handshake. Rejecting it
would break exactly the case this exists for, so the relay does no origin check.

## Wire protocol

JSON text frames, each with a `t` field.

### Client → server

| message | meaning |
|---|---|
| `{t:'hello', name, game?}` | announce yourself. `game` (optional) scopes which lobbies you see. |
| `{t:'list'}` | request the open-game list for your scope |
| `{t:'create', mode, name?}` | `mode` is `'1v1'` or `'2v2'` |
| `{t:'join', id}` | join a lobby by id |
| `{t:'leave'}` | leave your current lobby |
| `{t:'start'}` | **host only** — begin the match |
| `{t:'ord', c:{turn, o, cmds}}` | one turn's orders — **relayed verbatim** |
| `{t:'hash', turn, h, o}` | desync fingerprint — **relayed verbatim** |
| `{t:'ping'}` | → `{t:'pong'}` (liveness; the server also uses WS ping frames) |

### Server → client

| message | meaning |
|---|---|
| `{t:'hello', id, name}` | ack |
| `{t:'lobbies', lobbies:[…]}` | open games; each `{id,name,mode,game,started,players,capacity,host}` |
| `{t:'lobby', lobby, you, host}` | you are in this lobby; `you` = your slot index, `host` = boolean |
| `{t:'start', seed, slot, races, humans, mode, names}` | the match, dealt |
| `{t:'ord', c}` | another player's turn batch, unchanged |
| `{t:'hash', …}` | another player's fingerprint, unchanged |
| `{t:'peerLeft', name, slot}` | someone dropped — **`slot` is always included** |
| `{t:'err', msg}` | human-readable failure |

### The `start` payload

The server is authoritative over setup; every client gets the **same** values except `slot`:

- `seed` — one 32-bit integer; drives the map **and** every simulation decision
- `slot` — this client's player index (differs per client; assigned by join order)
- `races` — one race per slot, e.g. `['humans','undead']`. Valid: `humans`, `orcs`, `undead`
- `humans` — one boolean per slot; `false` slots are AI
- `mode` — `'1v1'` (2 slots) or `'2v2'` (4 slots)
- `names` — one display name per slot; AI slots get `AI (race)`

Race is **not** chosen client-side — it feeds the simulation, so independent picks desync.
`2v2` always deals 4 slots; empty ones become AI.

## Guarantees

1. A frame is relayed to the **other** members only — never echoed to its sender.
2. `ord` / `hash` payloads are forwarded byte-for-byte. No reordering, re-stamping, or validation.
3. `TCP_NODELAY` is set on every connection; frames are not batched or buffered.
4. `peerLeft` always carries `slot`, so the survivors can stop waiting on a player who left.
5. If every human leaves a match, its lobby is discarded.

## The one client-side change a game needs

The platform hands the game its relay URL two ways — pick whichever is easier:

- **Query param:** the game is loaded with `?arcade_mp=<wsUrl>&arcade_game=<slug>` appended.
- **postMessage:** once the frame loads, the host posts
  `{ type: 'arcade:mp', url: '<wsUrl>', game: '<slug>' }` to it.

So a game that currently does:

```js
const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
```

becomes:

```js
function resolveRelayUrl() {
  const fromQuery = new URLSearchParams(location.search).get('arcade_mp');
  if (fromQuery) return fromQuery;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host; // standalone fallback
}

let RELAY_URL = resolveRelayUrl();

// Optional: also accept it via postMessage (arrives right after load)
addEventListener('message', (e) => {
  if (e.data && e.data.type === 'arcade:mp' && typeof e.data.url === 'string') {
    RELAY_URL = e.data.url;
  }
});
```

Then connect with `new WebSocket(RELAY_URL)`. Everything else in a transport-agnostic
lockstep client already works unchanged.

If you also want the platform account as the player name, connect to
`RELAY_URL + '?token=' + token` — but the game frame is sandboxed and has no access to the
session, so the host would need to pass the token in too. Simpler to keep the free-text
`name` in `hello` for now.
