# @boilerx/templates

Stack templates materialized by `boiler new`.

## Layout

```
templates/
├── _common/        # files shared by every stack (Docker, CI, hooks, AGENTS.md)
├── node-api/       # Fastify + TypeScript + Vitest
├── node-web/       # Next.js + Tailwind + Vitest + Playwright
├── python-api/     # FastAPI + uv + Pytest + Ruff
└── python-cli/     # Typer + uv + Pytest + Ruff
```

## Status

**Phase 0 (current):** placeholder. Real templates land in Phase 1+.

## Templating model

- Files use `{{var}}` placeholders rendered by the CLI's renderer (Phase 1).
- Files are real source files (not `.tpl`) so editors stay happy and tests pass.
- Variables come from `ProjectConfig` (`packages/shared/src/project.ts`).

## What every stack must ship

- `Dockerfile` (multi-stage) + `.dockerignore`
- `docker-compose.yml` (dev profile)
- `Makefile` with `test`, `lint`, `run`, `docker`, `evolve`
- `.github/workflows/ci.yml` (lint → test → build → docker-build)
- `.gitignore` matching the language
- `AGENTS.md` with stack-specific conventions
- `.cursor/rules/*.mdc` mirroring AGENTS.md for Cursor
- `tests/unit/` skeleton + one passing example test
- Coverage threshold ≥ 80% wired in CI
- `.env.example`, structured logger, healthcheck (when applicable)
- Pre-commit hook (lefthook or husky) running format + lint
- Conventional Commits + commitlint config
