# SPEC — rate-limiter

## Purpose

Exact, lazy token-bucket admission with a second, distinct refusal for queue pressure.

## API

### `createLimiter({ capacity = 10, refillPerSec = 1, now = Date.now } = {})`

Validation:

| Option | Rule |
|---|---|
| `capacity` | positive integer |
| `refillPerSec` | positive finite number |
| `now` | function returning millis |

Throws `RangeError`/`TypeError` at construction, so a misconfigured limiter never starts.

#### `consume(key, cost = 1) → Result`

1. `key` must be a non-empty string, `cost` a positive integer.
2. Get or create the bucket `{tokens: capacity, last: now()}`.
3. On existing buckets, refill by elapsed time; a negative elapsed is clamped to 0.
4. If `cost > capacity` → `COST_EXCEEDS_CAPACITY`, no mutation.
5. If `tokens + EPSILON >= cost` → subtract, `{ok: true, remaining, retryAfterMs: 0}`.
6. Else → `NOT_ENOUGH_TOKENS` with `retryAfterMs = ceil(missing / refillPerSec × 1000)`.

`remaining` is fractional; callers should floor it if they display an integer.

#### `admit({ key, cost = 1, depth = 0, maxDepth = 200 }) → Result`

- `depth` and `maxDepth` must be non-negative integers.
- If `depth > maxDepth` → `{ok: false, code: 'QUEUE_FULL', remaining: null, retryAfterMs: 1500}` **before** token accounting.
- Otherwise delegates to `consume`.

#### `snapshot(key) → { tokens, capacity, refillPerSec }`

Refills first (lazily), then reports. Creating a snapshot for an unknown key initialises a full bucket.

#### `reset(key)`

Deletes the bucket. The next access starts at full capacity.

## Invariants

1. `0 <= tokens <= capacity` after every operation that refills.
2. Refill is monotone in elapsed time and linear in `refillPerSec`.
3. No operation can spend more than `capacity` in one call.
4. A refused request never consumes tokens.
5. `QUEUE_FULL` takes precedence over `NOT_ENOUGH_TOKENS`.
6. Keys are independent; `reset` affects exactly one key.
7. `retryAfterMs` is the smallest wait that makes the same request succeed, up to rounding.

## Known limits

- In-memory and per-process; horizontal scaling needs a shared counter.
- No burst smoothing beyond the bucket itself.
- No per-key capacity and no dynamic refill rate.
- `QUEUE_FULL`'s 1500 ms is a constant, not derived from observed drain time.

## Test map

`test/rate-limiter.test.mjs` — burst to empty, refill on fake clock, fractional tokens, cost above capacity, queue refusal precedence, key isolation, reset, snapshot, invalid inputs, retry timing, idempotent refusals.
