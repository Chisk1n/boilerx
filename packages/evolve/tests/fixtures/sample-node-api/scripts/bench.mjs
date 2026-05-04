import { add, multiply } from "../src/math.mjs";

const ITERATIONS = 1_000_000;

const start = process.hrtime.bigint();
let sum = 0;
for (let i = 0; i < ITERATIONS; i++) {
  sum = add(sum, 1);
  sum = multiply(sum, 1);
}
const elapsedNs = Number(process.hrtime.bigint() - start);
const opsPerSec = ITERATIONS / (elapsedNs / 1e9);

const target = 5_000_000;
const score = Math.min(1, opsPerSec / target);

process.stdout.write(`elapsed_ns=${elapsedNs}\n`);
process.stdout.write(`ops_per_sec=${Math.round(opsPerSec)}\n`);
process.stdout.write(`EVOLVE_BENCHMARK_SCORE=${score.toFixed(4)}\n`);
