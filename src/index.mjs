// SPDX-License-Identifier: MIT
/**
 * rate-limiter - an exact token bucket, plus a queue-depth refusal.
 *
 * Two refusals, two reasons: NOT_ENOUGH_TOKENS (come back in N ms) and
 * QUEUE_FULL (the work is already backing up; 1500 ms). Both return an honest
 * retryAfterMs instead of a bare 429.
 */
export function createLimiter({ capacity = 10, refillPerSec = 1, now = () => Date.now() } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
  if (typeof refillPerSec !== 'number' || !Number.isFinite(refillPerSec) || refillPerSec <= 0) {
    throw new RangeError('refillPerSec must be a positive finite number');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const buckets = new Map();

  function bucketOf(key) {
    if (typeof key !== 'string' || key.length === 0) throw new TypeError('key must be a non-empty string');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, last: now() };
      buckets.set(key, bucket);
    } else {
      const at = now();
      const elapsed = Math.max(0, at - bucket.last);
      if (elapsed > 0) {
        bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed / 1000) * refillPerSec);
        bucket.last = at;
      }
    }
    return bucket;
  }

  function consume(key, cost = 1) {
    if (!Number.isInteger(cost) || cost < 1) throw new RangeError('cost must be a positive integer');
    const bucket = bucketOf(key);
    if (cost > capacity) {
      return {
        ok: false,
        code: 'COST_EXCEEDS_CAPACITY',
        remaining: bucket.tokens,
        retryAfterMs: null,
      };
    }
    if (bucket.tokens + Number.EPSILON >= cost) {
      bucket.tokens -= cost;
      return { ok: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }
    const missing = cost - bucket.tokens;
    return {
      ok: false,
      code: 'NOT_ENOUGH_TOKENS',
      remaining: bucket.tokens,
      retryAfterMs: Math.ceil((missing / refillPerSec) * 1000),
    };
  }

  function admit({ key, cost = 1, depth = 0, maxDepth = 200 } = {}) {
    if (!Number.isInteger(depth) || depth < 0) throw new RangeError('depth must be a non-negative integer');
    if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new RangeError('maxDepth must be a non-negative integer');
    if (depth > maxDepth) {
      return { ok: false, code: 'QUEUE_FULL', remaining: null, retryAfterMs: 1500 };
    }
    return consume(key, cost);
  }

  function snapshot(key) {
    const bucket = bucketOf(key);
    return { tokens: bucket.tokens, capacity, refillPerSec };
  }

  function reset(key) {
    buckets.delete(key);
  }

  return { consume, admit, snapshot, reset, capacity, refillPerSec };
}
