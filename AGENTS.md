# AGENTS.md — boilerX repo

Rules every AI agent (Cursor, Claude Code, Codex, etc.) MUST follow when
working on this repository. Mirrors `.cursor/rules/` for tools that read
`AGENTS.md`.

## Project shape

This is an npm workspaces monorepo. Packages live under `packages/`:

- `@boilerx/shared` — pure TypeScript types, no runtime deps.
- `@boilerx/evolve` — Capa-2 loop interfaces and (later) implementation.
- `@boilerx/templates` — file-based stack templates, no compile step.
- `@boilerx/cli` — `boiler` CLI built with `commander`.

When in doubt: `docs/ARCHITECTURE.md` is the source of truth. Update it in the
same PR if your change diverges from it.

## Coding conventions

- TypeScript strict mode; respect `noUncheckedIndexedAccess`.
- ESM with `NodeNext` resolution. Imports inside this repo MUST end in `.js`.
- Module imports across packages use `@boilerx/<pkg>`, never relative paths.
- File names in kebab-case. Types/interfaces in PascalCase. Functions/vars in camelCase.
- No `any`. If you truly need it, use `unknown` and narrow.
- Error handling: throw `Error`. Wrap external errors with `{ cause }`.
- Logs go through `createLogger` from `@boilerx/shared`. Never `console.log`
  unless it's CLI human-facing output (then use `picocolors`).
- No comments that just narrate code. Comments only for non-obvious *why*.

## Capa 2 hard rules (do NOT violate)

If you are a worker agent operating under `boiler evolve`:

1. You may ONLY modify files listed in your assigned `hypothesis.affectedFiles`.
2. You MUST NOT touch `.judge/`, `.evolve/`, `tests/judge/`, or any file the
   Judge depends on.
3. You MUST NOT call back into LLMs that could leak the eval set.
4. You MUST run inside your assigned `git worktree` and never `cd ..` out.

If you are an architect or judge agent: you are READ-ONLY over the codebase.

## Tests & checks

- Run `npm run typecheck` before claiming a change works.
- Add a Vitest test under the package's `tests/` folder for any non-trivial
  logic (Phase 1+).
- Do not introduce a new dependency without listing it in `docs/ARCHITECTURE.md`'s
  decision log.

## Commits & PRs

- Conventional Commits. Examples:
  - `feat(cli): add boiler doctor command`
  - `fix(evolve): validate metric weights sum to 1`
  - `chore: bump typescript to 5.6.4`
- One concern per PR. Split if a diff touches Capa 1 and Capa 2 at once.
- Update `docs/` in the same PR as code changes that affect public surface.

## What to do if you're unsure

Ask in chat. Do not guess and ship. The user explicitly chose a "hybrid
runtime + composite metric + parallel capas" setup; deviate only with consent.
