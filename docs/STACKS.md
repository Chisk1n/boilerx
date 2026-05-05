# Stacks

Each stack is a self-contained template under `packages/templates/<stack>`.
On `boiler new my-app --stack <kind>`, the renderer:

1. Walks `packages/templates/_common/**` first.
2. Then walks `packages/templates/<kind>/**` (overlays the common files; later
   roots overwrite earlier ones at the same relative path).
3. For each file:
   - If the file ends in `.hbs`, its **content** is run through Handlebars
     using the `TemplateVars` derived from the `ProjectConfig`, and the
     `.hbs` extension is stripped on output.
   - If not, the file is copied verbatim. This keeps binary files and files
     that legitimately contain `{{ … }}` (e.g. test fixtures) safe.
4. Path components are also rendered, so directory names like `{{name}}/`
   work.
5. Optionally runs `git init`, `gh repo create`, and the first commit
   (deferred — Phase 4).

Available helpers in templates:

- `{{#if (eq language "typescript")}}` / `{{#if (eq language "python")}}`
- `{{upper x}}`, `{{lower x}}`, `{{kebab x}}`, `{{pascal x}}`

## Common files (every stack)

| File / path                         | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `Dockerfile`                        | Multi-stage build (deps → build → runtime)    |
| `docker-compose.yml`                | Dev profile with hot-reload                   |
| `.dockerignore`                     | Keep build context lean                       |
| `Makefile`                          | `test`, `lint`, `run`, `docker`, `evolve`     |
| `.github/workflows/ci.yml`          | lint → test → build → docker-build            |
| `.gitignore`                        | Language-specific                             |
| `.editorconfig`                     | Cross-editor formatting                       |
| `AGENTS.md`                         | Stack-specific conventions for AI agents      |
| `.cursor/rules/*.mdc`               | Mirror of AGENTS.md scoped to file globs      |
| `.env.example`                      | Required environment variables                |
| `README.md`                         | What the project is, how to run, how to test  |
| `CONTRIBUTING.md`                   | Branching, commits, PR rules                  |
| `commitlint.config.cjs`             | Conventional Commits enforcement              |
| `lefthook.yml` or `.husky/`         | Pre-commit: format + lint on staged files     |

## `node-api`

Fastify + TypeScript + Vitest.

| Concern        | Choice                                                 |
| -------------- | ------------------------------------------------------ |
| HTTP framework | Fastify                                                |
| Validation     | Zod                                                    |
| Logger         | pino (structured JSON)                                 |
| Tests          | Vitest (unit), Supertest (integration), Playwright?    |
| Lint/format    | Biome                                                  |
| Pkg manager    | npm (matches the boilerX root)                         |
| Healthcheck    | `GET /healthz` returning `{ ok: true }`                |
| OpenAPI        | `@fastify/swagger` + `@fastify/swagger-ui`             |

## `node-web`

Next.js 15 (App Router) + Tailwind v4 + Vitest + Playwright.

| Concern        | Choice                                                 |
| -------------- | ------------------------------------------------------ |
| Framework      | Next.js 15 App Router                                  |
| Styling        | Tailwind v4                                            |
| State (server) | React Server Components first, TanStack Query for client |
| Tests          | Vitest (units), Playwright (E2E)                       |
| Lint/format    | Biome                                                  |
| Healthcheck    | `app/api/healthz/route.ts`                             |

## `python-api`

FastAPI + uv + Pytest + Ruff.

| Concern        | Choice                                                 |
| -------------- | ------------------------------------------------------ |
| HTTP framework | FastAPI (async)                                        |
| Validation     | Pydantic v2                                            |
| Logger         | `loguru` configured for JSON output                    |
| Tests          | Pytest + pytest-asyncio + httpx                        |
| Lint/format    | Ruff (lint + format)                                   |
| Type checker   | mypy strict                                            |
| Pkg manager    | uv                                                     |
| Healthcheck    | `GET /healthz`                                         |
| OpenAPI        | Native FastAPI docs at `/docs`                         |

## `python-cli`

Typer + uv + Pytest + Ruff.

| Concern        | Choice                                                 |
| -------------- | ------------------------------------------------------ |
| Framework      | Typer (Click under the hood)                           |
| Tests          | Pytest + Typer's `CliRunner`                           |
| Lint/format    | Ruff                                                   |
| Type checker   | mypy strict                                            |
| Pkg manager    | uv                                                     |
| Distribution   | `uv build` → wheel; `uvx` runnable                     |

## Variables exposed to templates

From `ProjectConfig` (`packages/shared/src/project.ts`):

| Variable                | Source                            |
| ----------------------- | --------------------------------- |
| `{{name}}`              | CLI arg                           |
| `{{stack}}`             | `ProjectConfig.stack`             |
| `{{git.defaultBranch}}` | `ProjectConfig.git.defaultBranch` |
| `{{ci.coverageThreshold}}` | `ProjectConfig.ci.coverageThreshold` |
| `{{stackDescriptor.defaultPort}}` | `STACK_DESCRIPTORS[stack].defaultPort` |

Phase 1 will extend this list as templates need it.
