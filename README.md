# rate-limiter

An exact token bucket, plus a queue-depth refusal. Two refusals, two reasons, and an honest `retryAfterMs` instead of a bare `429`.

## Why

Rate limits usually fail in one of two ways: they are approximate (so the stated rate is a lie), or they return `429` with no guidance (so clients retry immediately and make it worse). This module keeps exact fractional tokens, separates "slow down" from "the queue is already full", and tells the caller exactly how long to wait.

## Quickstart

```sh
node --test test/        # 12 tests, no dependencies
node src/cli.mjs         # drains a bucket and refills it on a fake clock
node verify.mjs          # tests + CLI smoke, writes evidence.json
```

```js
import { createLimiter } from './src/index.mjs';

const limiter = createLimiter({ capacity: 3, refillPerSec: 1 });

limiter.consume('user:1');            // { ok: true, remaining: 2, retryAfterMs: 0 }
limiter.consume('user:1', 2);         // { ok: true, remaining: 0, retryAfterMs: 0 }
limiter.consume('user:1');            // { ok: false, code: 'NOT_ENOUGH_TOKENS', retryAfterMs: 1000 }
limiter.admit({ key: 'user:1', depth: 500, maxDepth: 200 });
// { ok: false, code: 'QUEUE_FULL', remaining: null, retryAfterMs: 1500 }
```

Final CLI line: `LIMITER ok=true`.

## Contract

| Export | Meaning |
|---|---|
| `createLimiter({ capacity?, refillPerSec?, now? })` | Returns `{ consume, admit, snapshot, reset, capacity, refillPerSec }` |
| `consume(key, cost = 1)` | Spend tokens; returns `{ok, code?, remaining, retryAfterMs}` |
| `admit({ key, cost?, depth?, maxDepth? })` | Queue-depth check first, then `consume` |
| `snapshot(key)` | `{tokens, capacity, refillPerSec}` at the current instant |
| `reset(key)` | Forgets the bucket; the next call starts full |

## Result shapes

| Case | `ok` | `code` | `retryAfterMs` |
|---|---|---|---|
| Spent | `true` | — | `0` |
| Too few tokens | `false` | `NOT_ENOUGH_TOKENS` | `ceil(missing / refillPerSec × 1000)` |
| Cost above capacity | `false` | `COST_EXCEEDS_CAPACITY` | `null` |
| Queue over depth | `false` | `QUEUE_FULL` | `1500` |

`COST_EXCEEDS_CAPACITY` is not retryable by waiting — the request can never fit.

## Refill model

Lazily, per bucket, on access: `tokens = min(capacity, tokens + elapsedMs/1000 × refillPerSec)`. Clock going backwards is treated as zero elapsed. There is no background timer, so an idle key costs nothing.

## Invariants (tested)

1. Tokens never exceed `capacity` and never go below zero.
2. `cost > capacity` is refused before any mutation.
3. Sequential spends of total `capacity` succeed; the next one fails with a positive `retryAfterMs`.
4. Waiting `retryAfterMs` makes the next identical request succeed.
5. Keys are isolated: draining one does not affect another.
6. `QUEUE_FULL` is checked before tokens, so a full queue is never charged.
7. Invalid capacity, refill rate, key, cost, depth or `maxDepth` throws.

## Limits

- Per-process, in-memory. Multiple instances need a shared store.
- Fixed capacity per limiter; no per-key overrides.
- `maxDepth` defaults to 200 and `QUEUE_FULL` always suggests 1500 ms.
- Token accounting uses `Number.EPSILON` tolerance; extreme rates lose precision eventually.

## Permissions

No network, no dependencies, no writes, no secrets. CI requests `contents: read`. See `permission-manifest.json`.

## License

MIT © 2026 Revan
