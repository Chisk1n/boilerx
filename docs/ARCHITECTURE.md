# Architecture

This document is the **single source of truth** for how `boilerX` is built.
Every PR that diverges from this doc must update it.

## High-level shape

```
┌──────────────────────────────────────────────────────────────────┐
│  packages/cli  ── `boiler` CLI (commander)                       │
│                                                                  │
│   boiler new <name>      ──▶ packages/templates  (Capa 1)        │
│   boiler evolve --target ──▶ packages/evolve     (Capa 2)        │
│   boiler doctor          ──▶ host tool checks                    │
└──────────────────────────────────────────────────────────────────┘
              │                                    │
              ▼                                    ▼
┌─────────────────────────────┐     ┌──────────────────────────────┐
│  packages/templates         │     │  packages/evolve             │
│  - _common (Docker, CI...)  │     │  - Architect (read-only)     │
│  - node-api / node-web      │     │  - Worker (write, sandboxed) │
│  - python-api / python-cli  │     │  - Judge (immutable)         │
│  - rendered via {{vars}}    │     │  - Orchestrator              │
└─────────────────────────────┘     └──────────────────────────────┘
              \                                    /
               \                                  /
                ▼                                ▼
              ┌────────────────────────────────────┐
              │  packages/shared                   │
              │  types · logger · constants        │
              └────────────────────────────────────┘
```

## Package responsibilities

### `@boilerx/shared`

Pure types and primitives. **Zero runtime dependencies** beyond Node stdlib.

- `StackKind`, `STACK_DESCRIPTORS`
- `ProjectConfig`, `DEFAULT_PROJECT_CONFIG`
- `EvolveRunConfig`, `Hypothesis`, `JudgeVerdict`, `IterationResult`, `EvolveRunSummary`
- `Logger` interface + a JSON `ConsoleLogger`

### `@boilerx/templates`

Plain files (no compile step). The CLI's renderer walks each template tree and
substitutes `{{var}}` placeholders driven by `ProjectConfig`. Files stay valid
in their host language so editors/tests don't break in the template repo
itself.

### `@boilerx/evolve`

Implements the **evaluator-optimizer** loop. Pure interfaces in Phase 0; the
orchestrator and the file-based JSONL run logger land in Phase 2. See
[EVOLVE.md](./EVOLVE.md) for the complete contract.

Key invariant: `Judge` is the only component whose code & prompt are immutable
during a run, verified by hash before each evaluation.

### `@boilerx/cli`

Thin command layer. Each subcommand registers itself in `src/index.ts` and
lives under `src/commands/`. Commands take a `Logger` and inject everything
else for testability.

## Conventions

- **Language**: TypeScript everywhere in the monorepo. Generated projects can
  be Python or TS — that's a runtime concern, not a repo concern.
- **Module system**: `NodeNext` ESM with explicit `.js` extensions in imports.
- **TS strictness**: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- **Lint**: TBD in Phase 1 (Biome is the leading candidate; ESLint+Prettier
  fallback). Decision deferred until templates need it too, to avoid drift.
- **Tests**: Vitest. Phase 0 only ships type-level checks.
- **Logging**: `createLogger` from `@boilerx/shared`. Always JSON. Never
  `console.log` directly except in CLI human-facing output, which uses
  `picocolors`.
- **Errors**: throw `Error` with a clear, single-sentence message. Wrap
  external errors with `{ cause }` (Node 22+). Never swallow.
- **Filenames**: kebab-case for files, PascalCase for types, camelCase for
  variables and functions.
- **Imports**: relative within a package; `@boilerx/<pkg>` across packages.

## Build & run

- `npm install` at the root installs the entire workspace.
- `npm run typecheck` runs `tsc -b` against the full project graph.
- `npm run build` compiles every package via `tsc -b`.
- `npm run dev:cli -- <args>` runs the CLI from source with `tsx`.

## Decision log

| Date       | Decision                              | Rationale                                       |
| ---------- | ------------------------------------- | ----------------------------------------------- |
| 2026-05-04 | npm workspaces (not pnpm)             | One less host requirement; trivial to migrate.  |
| 2026-05-04 | TypeScript for the CLI                | Strong typing across template metadata + evolve types. |
| 2026-05-04 | Polyglot templates, single CLI        | User asked the CLI to ask which stack on `new`. |
| 2026-05-04 | Hybrid agent runtime (own orch + SDK) | User choice. Keeps control where it matters.    |
| 2026-05-04 | Composite metric for Judge            | User choice. Anti-Goodhart by combining axes.   |
| 2026-05-04 | No deploy in Phase 0                  | User scope: local Docker only.                  |
