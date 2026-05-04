# boilerX

> Full-SDLC project scaffolder **+** autonomous code-evolution loop, in one CLI.

`boilerX` is two things stacked into one tool:

1. **Capa 1 — `boiler new <project>`**: scaffolds a new project with **the boring-but-correct stuff already done**: git, Docker, tests pyramid, linter/formatter, pre-commit hooks, Conventional Commits, GitHub Actions CI, structured logging, observability, and AI-agent instructions (`AGENTS.md` + `.cursor/rules`). Polyglot: pick `node-api`, `node-web`, `python-api`, or `python-cli`.

2. **Capa 2 — `boiler evolve`**: an **autonomous evaluator-optimizer loop** in the spirit of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). An *Architect* agent proposes hypotheses, *N* *Worker* agents implement them in parallel inside isolated `git worktrees`, and a *Judge* (whose code & prompt are **immutable and hash-pinned**) scores each attempt against a composite metric. The orchestrator keeps winners and reverts losers.

> [!IMPORTANT]
> This repo is in **Phase 0 (scaffolding)**. CLI commands exist and print plans
> but do not yet write template files (Phase 1) or run agents (Phase 2). See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full plan.

## Why two capas in one tool?

The boring scaffolding (Capa 1) makes every project legible to both humans and
agents. Once a project has a `Makefile`, a CI definition, a tests folder and a
clear `AGENTS.md`, you can point Capa 2 at it and it knows how to evaluate
itself (`make test`, `make bench`, `make lint`). One enables the other.

## Quick start

```bash
git clone https://github.com/Chisk1n/boilerx
cd boilerx
npm install
npm run build
npm test -w @boilerx/evolve

node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js judge \
  --target packages/evolve/tests/fixtures/sample-node-api
node packages/cli/dist/index.js new my-app --stack node-api
node packages/cli/dist/index.js evolve --target ./my-app
```

Or in dev mode (no build):

```bash
npm run dev:cli -- doctor
npm run dev:cli -- judge --target packages/evolve/tests/fixtures/sample-node-api
```

## What's in the box

```
boilerX/
├── packages/
│   ├── shared/      # cross-package types (StackKind, ProjectConfig, EvolveRun)
│   ├── evolve/      # Capa 2: Judge / Architect / Worker / Orchestrator
│   ├── templates/   # Stack templates (Phase 1+)
│   └── cli/         # `boiler` CLI: new, evolve, doctor
├── docs/
│   ├── ARCHITECTURE.md
│   ├── EVOLVE.md
│   └── STACKS.md
├── .cursor/rules/   # rules every agent in this repo must respect
└── AGENTS.md        # convention summary for AI agents
```

## Roadmap

| Phase  | Capa 1                              | Capa 2                                       |
| ------ | ----------------------------------- | -------------------------------------------- |
| 0 ✅   | Monorepo + CLI skeleton             | Type interfaces (`Judge`, `Architect`, …)    |
| 1 🚧  | `node-api` + `python-api` templates | **`LocalJudge` with composite metric ✅**    |
| 2      | `node-web` + `python-cli` templates | Orchestrator + Docker sandbox                |
| 3      | `gh` integration ✅, branch protection ✅ | Worktrees + N parallel workers          |
| 4      | Polish, docs, self-tests            | Architect agent + circuit breakers + budget  |
| 5      | Stable 1.0                          | LLM-as-judge optional + run dashboard        |

## Background reading

- Karpathy, [autoresearch](https://github.com/karpathy/autoresearch) — the canonical "agent edits code, runs eval, keeps winners" loop.
- Anthropic, ["Building effective agents"](https://www.anthropic.com/research/building-effective-agents) — the **evaluator-optimizer** pattern.
- Code with Antonio / learnwithparam, [Build Your Own Claude Code](https://www.learnwithparam.com/workshops/build-your-own-claude-code) — agent loop, tools, subagents, context compaction, multi-agent teams, git worktree isolation. The Capa-2 orchestrator borrows ideas from this.

## License

MIT — see [LICENSE](LICENSE).
