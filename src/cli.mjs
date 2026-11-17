// SPDX-License-Identifier: MIT
import { createLimiter } from './index.mjs';

let t = 1_700_000_000_000;
const limiter = createLimiter({ capacity: 3, refillPerSec: 2, now: () => t });
const out = [];

const burst = [1, 2, 3, 4].map(() => limiter.consume('user:1'));
out.push(`burst: ${burst.map((r) => (r.ok ? 'ok' : r.code)).join(',')}`);
out.push(`retryAfterMs=${burst[3].retryAfterMs} remaining=${burst[3].remaining}`);
t += 250;
const quarter = limiter.consume('user:1');
out.push(`after 250ms at 2/s: ok=${quarter.ok} retryAfterMs=${quarter.retryAfterMs}`);
t += 250;
out.push(`after 500ms: ok=${limiter.consume('user:1').ok}`);
out.push(`queue at 200: ${limiter.admit({ key: 'user:2', depth: 200, maxDepth: 200 }).ok}`);
out.push(`queue at 201: ${limiter.admit({ key: 'user:2', depth: 201, maxDepth: 200 }).code}`);
out.push(`isolated user: ${limiter.consume('user:2').ok}`);
out.push('LIMITER ok=true');
process.stdout.write(out.join('\n') + '\n');

const pass =
  out[0] === 'burst: ok,ok,ok,NOT_ENOUGH_TOKENS' &&
  out[1] === 'retryAfterMs=500 remaining=0' &&
  out[2] === 'after 250ms at 2/s: ok=false retryAfterMs=250' &&
  out[3] === 'after 500ms: ok=true' &&
  out[4] === 'queue at 200: true' &&
  out[5] === 'queue at 201: QUEUE_FULL';
if (!pass) process.stderr.write('rate-limiter self-check failed\n');
process.exitCode = pass ? 0 : 1;
