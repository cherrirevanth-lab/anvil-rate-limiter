// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../src/index.mjs';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

test('a burst of exactly capacity is allowed', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 3, refillPerSec: 1, now: c.now });
  for (let i = 0; i < 3; i += 1) assert.equal(limiter.consume('k').ok, true);
  assert.equal(limiter.snapshot('k').tokens, 0);
});

test('capacity + 1 is refused with an exact retryAfterMs', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 3, refillPerSec: 1, now: c.now });
  limiter.consume('k');
  limiter.consume('k');
  limiter.consume('k');
  const denied = limiter.consume('k');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'NOT_ENOUGH_TOKENS');
  assert.equal(denied.retryAfterMs, 1000);
});

test('cost 2 with one token left needs one second at 1/s', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 3, refillPerSec: 1, now: c.now });
  limiter.consume('k');
  limiter.consume('k');
  const denied = limiter.consume('k', 2);
  assert.equal(denied.remaining, 1);
  assert.equal(denied.retryAfterMs, 1000);
});

test('refill is continuous, not on a tick', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 1, refillPerSec: 1, now: c.now });
  assert.equal(limiter.consume('k').ok, true);
  c.advance(500);
  const half = limiter.consume('k');
  assert.equal(half.ok, false);
  assert.equal(half.retryAfterMs, 500);
  c.advance(500);
  assert.equal(limiter.consume('k').ok, true);
});

test('keys are isolated', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 1, refillPerSec: 1, now: c.now });
  assert.equal(limiter.consume('alice').ok, true);
  assert.equal(limiter.consume('alice').ok, false);
  assert.equal(limiter.consume('bob').ok, true);
});

test('a cost above capacity is impossible, not merely queued', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 2, refillPerSec: 10, now: c.now });
  const result = limiter.consume('k', 3);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COST_EXCEEDS_CAPACITY');
  assert.equal(result.retryAfterMs, null);
});

test('queue depth at the limit is allowed and one past is refused', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 10, refillPerSec: 1, now: c.now });
  assert.equal(limiter.admit({ key: 'k', depth: 200, maxDepth: 200 }).ok, true);
  const full = limiter.admit({ key: 'k', depth: 201, maxDepth: 200 });
  assert.equal(full.ok, false);
  assert.equal(full.code, 'QUEUE_FULL');
  assert.equal(full.retryAfterMs, 1500);
});

test('queue pressure is checked before tokens', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 5, refillPerSec: 1, now: c.now });
  const full = limiter.admit({ key: 'k', depth: 999, maxDepth: 10 });
  assert.equal(full.code, 'QUEUE_FULL');
  assert.equal(limiter.snapshot('k').tokens, 5, 'a refused admission spends no token');
});

test('a backwards clock cannot mint tokens', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 2, refillPerSec: 1, now: c.now });
  limiter.consume('k');
  c.set(c.now() - 60_000);
  limiter.consume('k');
  assert.equal(limiter.snapshot('k').tokens, 0);
});

test('tokens never go negative', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 2, refillPerSec: 1, now: c.now });
  limiter.consume('k');
  limiter.consume('k');
  limiter.consume('k');
  assert.equal(limiter.snapshot('k').tokens, 0);
  assert.ok(limiter.snapshot('k').tokens >= 0);
});

test('reset restores the full bucket', () => {
  const c = clock();
  const limiter = createLimiter({ capacity: 1, refillPerSec: 1, now: c.now });
  limiter.consume('k');
  limiter.reset('k');
  assert.equal(limiter.consume('k').ok, true);
  assert.equal(limiter.snapshot('k').tokens, 0);
});

test('invalid configuration and cost are refused', () => {
  assert.throws(() => createLimiter({ capacity: 0 }), RangeError);
  assert.throws(() => createLimiter({ capacity: 1.5 }), RangeError);
  assert.throws(() => createLimiter({ refillPerSec: 0 }), RangeError);
  const limiter = createLimiter();
  assert.throws(() => limiter.consume('k', 0), RangeError);
  assert.throws(() => limiter.consume(''), TypeError);
  assert.throws(() => limiter.admit({ key: 'k', depth: -1 }), RangeError);
});
