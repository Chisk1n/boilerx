# Capa 2 — Autonomous code-evolution loop

> Inspired by Karpathy's [autoresearch](https://github.com/karpathy/autoresearch)
> and Anthropic's evaluator-optimizer pattern. Adapted for general software
> projects (not just ML training).

## Mental model

```
   ┌──────────────────────────────────────────────────────┐
   │                Architect (read-only)                 │
   │   reads:  code, history of past iterations, scores   │
   │   emits:  N small, testable Hypotheses               │
   └──────────────────────────────────────────────────────┘
                         │
                         ▼
   ┌──────────────────────────────────────────────────────┐
   │   N Workers (write, sandboxed in `git worktree`)     │
   │   each Worker:                                       │
   │     - takes ONE hypothesis                           │
   │     - may only modify hypothesis.affectedFiles       │
   │     - MUST NOT touch .judge/ or .evolve/             │
   └──────────────────────────────────────────────────────┘
                         │
                         ▼
   ┌──────────────────────────────────────────────────────┐
   │             Judge (immutable, hash-pinned)           │
   │   - read-only over the worktree                      │
   │   - runs in Docker with --network=none by default    │
   │   - returns deterministic score in [0, 1]            │
   │   - prompt + code hash verified before each eval     │
   └──────────────────────────────────────────────────────┘
                         │
                         ▼
   ┌──────────────────────────────────────────────────────┐
   │                Orchestrator                          │
   │   keep best, revert losers, log JSONL, enforce       │
   │   budget (iterations / wall-time / USD).             │
   └──────────────────────────────────────────────────────┘
```

## Why this shape

The user's intuition was correct: **the evaluator must be immutable**. If
workers can modify the judge, the system collapses into reward hacking — it
learns to satisfy the judge instead of the underlying goal (Goodhart's law).
We enforce this with hashes, not with politeness.

The architect is **separate** from the workers because it has a different job:
strategic exploration vs tactical implementation. Mixing them inside a single
agent loses the search-vs-exploit signal across iterations.

## The composite metric (anti-Goodhart)

The Judge's score is a weighted sum of independent axes. Defaults — editable
per project in `.judge/metric.yaml`:

| Axis             | Weight | What it measures                                        |
| ---------------- | -----: | ------------------------------------------------------- |
| `testsPassing`   |   0.40 | Fraction of test suite that passes                      |
| `coverageDelta`  |   0.15 | Change in coverage vs. baseline (clamped to `[0,1]`)    |
| `benchmarkScore` |   0.25 | Project-defined performance benchmark                    |
| `lintScore`      |   0.10 | `1 - (lint_violations / max_violations)`                |
| `llmJudgeRubric` |   0.10 | LLM scoring against a `rubric.md`. Optional, off by default. |

Weights MUST sum to `1.0`. The framework validates this at run start.

If you only want a single metric (Karpathy-style), set its weight to `1.0` and
the rest to `0`. The default mix is opinionated for "general software projects"
where tests + perf + cleanliness matter.

## Anti-cheating safeguards

1. **Judge hash pinning**. At `boiler evolve` start we compute
   `sha256(judge_prompt + judge_code + metric.yaml)` and verify it before every
   evaluation. Mismatch → run aborts.
2. **Path whitelist per worker**. A worker that writes outside its
   `hypothesis.affectedFiles` has its iteration discarded.
3. **Forbidden paths**. Workers can never write under `.judge/`, `.evolve/`,
   `tests/judge/`, or `Makefile` (the eval entrypoints). Enforced via git
   pre-commit in the worktree.
4. **Network sandbox**. Judge container runs with `--network=none` unless the
   metric explicitly opts in.
5. **Determinism check**. The Judge re-runs each iteration twice and aborts if
   scores differ by more than ε; flaky benchmarks must be fixed before evolve.
6. **Budget circuit breakers**. Hard caps on iterations, wall-time, and USD.

## Run lifecycle

```
boiler evolve --target ./my-app --max-iterations 20 --workers 3 --max-cost-usd 5
  │
  ├─ load metric.yaml  →  hash the judge bundle
  ├─ baseline eval     →  record score₀
  ├─ for each iteration i in [1..N]:
  │    ├─ architect.proposeHypotheses(history, n=3)
  │    ├─ Promise.all(workers[1..3].apply(hᵢ in worktreeᵢ))
  │    ├─ for each worktree: judge.evaluate(...)
  │    ├─ pick best; if better than running best: keep, else: discard
  │    └─ append iteration record to .evolve/runs/<runId>.jsonl
  └─ summarize → print report + best worktree path
```

## Run log (JSONL schema)

Each line is one of:

```json
{"type":"start", "runId":"run-1714838400000", "config":{...}}
{"type":"iteration", "i":3, "hypothesisId":"h-3a", "score":0.71, "kept":true}
{"type":"abort",     "reason":"judge-hash-drift", "expected":"…", "got":"…"}
{"type":"end",       "bestScore":0.84, "bestIteration":11, "totalCostUsd":1.23}
```

## Status

### Phase 1 ✅ Judge standalone

`LocalJudge` exercised by Vitest against `tests/fixtures/sample-node-api`.

```bash
boiler judge --target ./your-project --metric .judge/metric.yaml
```

What works:

- YAML metric loading with strict weight validation (sum == 1.0 enforced).
- Composite metric over four axes: tests, coverage, benchmark, lint.
- Hash pinning over `judgeVersion + metric.yaml + spec`.
- Output parsers for jest, mocha, node:test, istanbul, coverage.py, eslint, ruff.
- Benchmark axis gated on `EVOLVE_BENCHMARK_SCORE=…` line (refuses to guess).
- Hard timeouts per command, full execution logs captured for audit.

### Phase 2 ✅ Worktrees + RunLogger + Orchestrator

Full evaluator-optimizer loop running with deterministic stubs.

```bash
boiler evolve --target ./your-project --max-iterations 5 --workers 2
```

What works:

- `WorktreeManager`: creates / removes / lists ephemeral `git worktree`s under
  `.evolve/worktrees/`, sanitizes IDs, falls back to filesystem cleanup on
  failure, and writes a one-shot local gitignore for `.evolve/`.
- `RunLogger`: append-only JSONL with `fsync` per write. Tagged-union records
  (`start`, `iteration`, `abort`, `end`). `readRunLog` rejects malformed lines
  and unknown discriminator types.
- `Orchestrator`:
  - Refuses to start on a dirty working tree.
  - Records baseline score before iterations begin.
  - Pins the Judge hash at start; aborts on drift.
  - Enforces budgets (cost / iterations / wall-time).
  - Runs `workersPerIteration` workers in parallel, one git worktree each.
  - Picks the best per-iteration; flags `kept` if it improves the running best.
  - Cleans up every worktree at the end of each iteration (winners included
    for now; Phase 3 will optionally retain the winning worktree for
    inspection).
- `StubArchitect` / `StubWorker`: deterministic implementations for tests and
  smoke runs. They satisfy the `Architect` / `Worker` interfaces, so swapping
  them for LLM-backed implementations later doesn't touch the orchestrator.

### Phase 3 ✅ CursorArchitect + CursorWorker (full LLM loop)

Both the Architect and the Worker are now LLM-backed via `@cursor/sdk`.

`CursorArchitect`:
- Runs `Agent.prompt(...)` against the **target repo**, asks for `n` JSON
  hypotheses, parses with retry-on-malformed (default 1 retry), and assigns
  stable IDs (`h-<callIndex>-<i>`).
- Read-only enforcement: after every prompt, `git checkout HEAD -- .` and
  `git clean -fd .` discard any working-tree changes the LLM made while
  exploring. The orchestrator's hash-pinning would catch tampering anyway,
  but reverting prevents wasted iterations.
- Forbidden paths (`.judge/`, `.evolve/`, `tests/judge/`, `.git/`, `.github/`,
  `Makefile`) are stripped from `affectedFiles` automatically before the
  hypothesis reaches the worker.

`CursorWorker` runs `Agent.prompt(...)` from `@cursor/sdk` against a worktree.
File-edit safeguards run after every prompt:

- Files modified outside `hypothesis.affectedFiles` are reverted with
  `git checkout -- <file>`.
- Files matching forbidden prefixes (`.judge/`, `.evolve/`, `tests/judge/`,
  `.git/`, `.github/`, `Makefile`) are reverted unconditionally.
- The orchestrator only sees `WorkerOutput.filesModified` filtered to
  authorized paths.

```bash
# .env (gitignored)
CURSOR_API_KEY=cursor_…

# Run
node --env-file=.env packages/cli/dist/index.js evolve \
  --target ./your-project \
  --runtime cursor --model composer-2 \
  --max-iterations 5 --workers 2 --max-cost-usd 1.00
```

### Phase 4 (in progress) — Cost reporting

Both the Architect and Worker now report estimated USD cost per run via
`packages/evolve/src/cost.ts`. The Cursor SDK does **not** expose
authoritative cost or token counts on its `RunResult`, so we approximate:

```
inputTokens  = ceil(prompt.length / 4)
outputTokens = ceil(response.length / 4)
inputUsd     = inputTokens / 1_000_000 * pricing.inputPerMTokens
outputUsd    = outputTokens / 1_000_000 * pricing.outputPerMTokens
total        = round6(inputUsd + outputUsd)
```

Pricing defaults live in `DEFAULT_PRICING` (composer-2, claude-sonnet-4-x,
gpt-5.x, gemini-3.x, etc.). Override at runtime via `BOILERX_PRICING` env
var (JSON):

```bash
BOILERX_PRICING='{"composer-2":{"inputPerMTokens":3,"outputPerMTokens":15}}'
```

Errors of ±30% are normal: tokenizers differ, thinking/tool-call tokens get
billed but not surfaced, and pricing changes faster than this map. **Use
`--max-cost-usd` with margin and reconcile against your Cursor dashboard
for ground truth.** Unknown models fall back to a conservative high tier so
the budget cap errs on the safe side.

`Architect.proposeHypotheses` now returns `{ hypotheses, costUsd }`; the
orchestrator threads architect cost into both the per-iteration log record
and the budget circuit-breaker.

### What's NOT done yet (rest of Phase 4 / Phase 5)

- Auto-apply winning worktree back to base.
- Docker sandbox around Judge command execution.
- LLM-as-judge backend for the `llmJudgeRubric` axis.
- Determinism check (re-run each iteration twice and compare).
- Resume support after a killed run.

## Open questions (to resolve in Phase 2)

- **Worker SDK selection**: Cursor SDK vs. Claude Agent SDK vs. raw
  `litellm`? Decide when implementing `worker.ts`.
- **Hypothesis granularity**: should the Architect emit *patches* or
  *natural-language directives*? Lean toward directives for flexibility, but
  patches give cleaner rollback.
- **Resume support**: persist enough state in `.evolve/state.json` to resume a
  killed run. Worth it once runs cost real money.
- **Multi-objective Pareto front**: instead of collapsing to a single score,
  keep a Pareto frontier across the axes. Useful but more complex; defer.

## Reading list

- Karpathy, [autoresearch](https://github.com/karpathy/autoresearch)
- Anthropic, ["Building effective agents"](https://www.anthropic.com/research/building-effective-agents)
- Madaan et al., [Self-Refine (2023)](https://arxiv.org/abs/2303.17651)
- Shinn et al., [Reflexion (2023)](https://arxiv.org/abs/2303.11366)
- DeepMind, [AlphaEvolve (2025)](https://deepmind.google/discover/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
