# boilerX — Manual de usuario

> Versión del proyecto: estado tras PR #8 (Phase 4 parcial — cost reporting + auto-apply)
> Fecha de generación: ver pie de cada página
>
> **Repo**: https://github.com/Chisk1n/boilerx · **Licencia**: MIT

---

## Índice

1. [¿Qué es boilerX?](#1-qué-es-boilerx)
2. [Estado actual del proyecto](#2-estado-actual-del-proyecto)
3. [Conceptos clave](#3-conceptos-clave)
4. [Instalación y configuración inicial](#4-instalación-y-configuración-inicial)
5. [Tu primer comando: `boiler doctor`](#5-tu-primer-comando-boiler-doctor)
6. [Crear un proyecto nuevo: `boiler new`](#6-crear-un-proyecto-nuevo-boiler-new)
7. [Probar el Judge solo: `boiler judge`](#7-probar-el-judge-solo-boiler-judge)
8. [El loop completo: `boiler evolve`](#8-el-loop-completo-boiler-evolve)
9. [Anatomía de `.judge/metric.yaml`](#9-anatomía-de-judgemetricyaml)
10. [Salvaguardas anti-Goodhart](#10-salvaguardas-anti-goodhart)
11. [El JSONL de auditoría](#11-el-jsonl-de-auditoría)
12. [Caso de estudio: el experimento `demo-calc`](#12-caso-de-estudio-el-experimento-demo-calc)
13. [Workflow típico de uso](#13-workflow-típico-de-uso)
14. [Configuración por variables de entorno](#14-configuración-por-variables-de-entorno)
15. [Troubleshooting](#15-troubleshooting)
16. [Glosario](#16-glosario)
17. [Roadmap](#17-roadmap)

---

## 1. ¿Qué es boilerX?

**boilerX hace dos cosas en un mismo CLI**, y por eso vale la pena entender ambas antes de usarlo.

### 1.1 Capa 1 — Scaffolder (`boiler new`)

Genera proyectos nuevos con todo lo aburrido-pero-correcto del SDLC ya hecho:

- `git` listo para commitear
- `AGENTS.md` con convenciones para humanos y agentes IA
- `.cursor/rules/project.mdc` para que Cursor respete tu estilo
- `LICENSE` MIT con tu autor + año
- `.gitignore` específico al lenguaje
- `.editorconfig` cross-editor
- `.env.example` con las vars que el proyecto necesita
- `commitlint.config.cjs` con Conventional Commits
- `README.md` con badges, make targets y conventions

Pensado para que cada vez que arranques un proyecto **no tengas que volver a configurar el mismo bootstrap** y para que cualquier agente IA que lo toque desde el día 1 ya sepa las reglas.

### 1.2 Capa 2 — Loop de auto-mejora (`boiler evolve`)

Inspirado en [autoresearch de Karpathy](https://github.com/karpathy/autoresearch) y en el patrón **evaluator-optimizer** de Anthropic.

Le apuntas a cualquier repo tuyo con un `.judge/metric.yaml` y boilerX corre este ciclo:

1. Un *Architect* (LLM) **lee tu código** y propone N hipótesis (cambios pequeños, testeables).
2. N *Workers* (LLM) toman cada hipótesis y la implementan en `git worktree` aislados, en paralelo.
3. Un *Judge* (código fijo, hash-pinned, **inmutable durante el run**) ejecuta los tests/coverage/benchmark/lint y devuelve un score numérico.
4. El *Orchestrator* se queda con la hipótesis que más mejora, descarta el resto, y la **commitea automáticamente** a tu rama. La siguiente iteración parte de ese estado.
5. Repite hasta que se acabe el presupuesto (`--max-iterations`, `--max-cost-usd`, `--max-wall-min`) o el score se estanca.

Todo el run queda en `.evolve/runs/<runId>.jsonl` para auditoría.

### 1.3 Por qué las dos capas en un mismo CLI

La Capa 1 hace que cada proyecto sea **legible** para humanos y agentes (`AGENTS.md`, `.cursor/rules`, métricas estandarizadas). Una vez que el proyecto tiene esa estructura, la Capa 2 lo puede operar autónomamente sin tener que adivinar qué significa "calidad" en ese repo: lo dice `.judge/metric.yaml`.

Una habilita a la otra.

---

## 2. Estado actual del proyecto

### 2.1 Lo que funciona hoy

| Comando | Estado | Qué hace |
|---|---|---|
| `boiler doctor` | ✅ | Verifica que tienes node, npm, git, docker, gh, uv |
| `boiler new <name>` | ✅ | Genera proyecto nuevo con plantilla `_common` (AGENTS.md, README, LICENSE, .gitignore, etc.) |
| `boiler judge --target <path>` | ✅ | Corre solo el Judge sobre un proyecto y devuelve score |
| `boiler evolve --runtime stub` | ✅ | Loop completo con stubs determinísticos (sin LLM, gratis, ideal para CI) |
| `boiler evolve --runtime cursor` | ✅ | Loop completo con **Architect+Worker LLM** vía Cursor SDK |
| `boiler evolve --no-auto-apply` | ✅ | Loop sin auto-commit del ganador (modo legacy) |
| Cost reporting estimado | ✅ | `total cost: $0.XXXX` real basado en token-counting |
| Auto-apply del ganador | ✅ | Cada iteración kept es un commit; iter siguiente parte del estado mejorado |

### 2.2 Lo que aún NO existe (Phase 4+ pendiente)

- Plantillas específicas por stack (`node-api`, `python-api`, `node-web`, `python-cli`) — solo `_common` por ahora
- Docker sandbox alrededor del Judge (hoy corre en host)
- `git init` automático al `boiler new` (manual por ahora)
- `gh repo create` automático al `boiler new`
- LLM-as-judge para el axis `llmJudgeRubric` (peso 0 fijo)
- Determinism check del Judge (re-run de cada eval)
- Resume support después de un kill mid-run

### 2.3 Salud técnica

- **88 tests** Vitest pasando (CLI + Evolve packages)
- **CI verde** en cada PR vía GitHub Actions (typecheck + build + tests + smoke del CLI)
- **Branch protection** en `main`: PR requerido + 1 review + linear history + no force push
- TypeScript strict en todo el monorepo
- npm workspaces, sin dependencias innecesarias

---

## 3. Conceptos clave

Estos términos aparecen por todas partes; vale la pena fijarlos antes de seguir.

### 3.1 Architect

El agente que **lee tu código** y **propone N hipótesis** por iteración. **Read-only** — no modifica archivos. Su salida es un array JSON con shape:

```json
{
  "summary": "qué hace este cambio en una línea",
  "rationale": "por qué crees que mejora la métrica",
  "affectedFiles": ["src/foo.ts", "src/foo.test.ts"]
}
```

`affectedFiles` es **whitelist**: el worker que implemente esta hipótesis solo puede tocar esos archivos.

Implementaciones disponibles:

- `StubArchitect` — devuelve hipótesis fijas de un pool. Determinístico, gratis. Usado por `--runtime stub`.
- `CursorArchitect` — usa `@cursor/sdk` con `Agent.prompt()`. Cuesta tokens. Usado por `--runtime cursor`.

### 3.2 Worker

El agente que **toma una hipótesis** del Architect y **la implementa** en su propio `git worktree`. Cada hipótesis tiene su propio worker, y todos corren en paralelo (`workersPerIteration`).

Implementaciones disponibles:

- `StubWorker` — ejecuta una `mutate` function provista por el caller. Para tests.
- `CursorWorker` — usa `Agent.prompt()` con un prompt que incluye:
  - El summary y rationale de la hipótesis
  - La whitelist de `affectedFiles`
  - Reglas duras: no tocar `.judge/`, `.evolve/`, `.git/`, `.github/`, `Makefile`, `tests/judge/`
  - Instrucción de NO commitear (lo hace el orchestrator)

Después de cada `apply()`, dos salvaguardas:

1. **Whitelist enforcement**: archivos modificados fuera de `affectedFiles` se revierten con `git checkout HEAD -- <file>`.
2. **Forbidden paths**: archivos bajo prefijos prohibidos se revierten **incluso si están en la whitelist** (anti-Goodhart).

### 3.3 Judge

El componente que **decide si una iteración mejoró**. Es código fijo, no un LLM. Lee `.judge/metric.yaml` y ejecuta los comandos definidos:

- `testsCommand`
- `coverageCommand`
- `benchmarkCommand` (opcional)
- `lintCommand` (opcional)

Cada comando produce output que se parsea a un valor en `[0, 1]`. La salida final es:

```
score = Σ (weight_i × value_i)   donde Σ weights = 1.0
```

**Inmutable durante un run**: al iniciar, calculamos `sha256(judgeVersion + metric.yaml + spec)` y verificamos antes de cada evaluación. Si cambia (por ejemplo, un worker travieso modificó el `metric.yaml`), el run aborta inmediatamente.

### 3.4 Orchestrator

El **director de orquesta**. No tiene LLM ni juicio propio: solo coordina.

Pseudo-código:

```
ensureBaseClean()              # rechaza si working tree sucio
baseline = judge.evaluate(target)
runningBest = baseline.score

for i in [1..maxIterations]:
  if budget exceeded: abort
  proposal  = architect.proposeHypotheses(history, N)
  results   = await Promise.all(N workers, cada uno en su worktree)
  best      = max(results, by score)
  kept      = best.score > runningBest
  if kept and autoApplyWinner:
    applyWorktreePatch(best.worktree, "feat(evolve): ...")
    # ↑ git diff + git apply + git commit en el base
  cleanup all worktrees of this iteration
  if kept: runningBest = best.score
```

### 3.5 Métrica composite

La definición operacional de "mejor" para tu proyecto. Es **lo único** que hay que diseñar bien — el resto es plomería. Ver §9.

### 3.6 worktree (Git)

Un *worktree* es una **copia funcional adicional** de un repo Git, en una carpeta distinta, en una rama distinta. boilerX crea uno por cada hipótesis, todos compartiendo la misma `.git/` pero apuntando a ramas separadas (`evolve/<runId>/<hypId>`). Permite ejecutar N agentes en paralelo sin que se pisen.

Tras la iteración, todos los worktrees se eliminan (`git worktree remove`).

---

## 4. Instalación y configuración inicial

### 4.1 Pre-requisitos del sistema

| Tool | Versión mínima | Estado |
|---|---|---|
| Node.js | 22.x | **Obligatorio** |
| npm | 11.x (viene con Node) | **Obligatorio** |
| git | 2.x | **Obligatorio** |
| Docker | cualquier reciente | Opcional (solo si usarás Phase 5+ con Docker sandbox) |
| GitHub CLI (`gh`) | 2.x | Opcional (para `gh repo create` automatizado) |
| `uv` (Python) | cualquier reciente | Opcional (solo si harás stacks Python) |

### 4.2 Clonar y construir

```bash
git clone https://github.com/Chisk1n/boilerx
cd boilerx
npm install
npm run build
```

Tras `npm run build`, el CLI ejecutable está en `packages/cli/dist/index.js`.

### 4.3 Configurar la API key (solo para `--runtime cursor`)

La Capa 1 (`boiler new`, `boiler judge`) **no necesita ninguna key**. La Capa 2 con LLM real (`boiler evolve --runtime cursor`) sí.

Pasos:

1. Mintea tu key en https://cursor.com/dashboard
2. Copia el template:
   ```bash
   cp .env.example .env
   ```
3. Edita `.env` y pega tu key después de `CURSOR_API_KEY=`:
   ```
   CURSOR_API_KEY=cursor_TU_KEY_AQUÍ
   ```

El `.env` está gitignored, **nunca se commitea**. `.env.example` sí está en git como documentación.

> **Nota**: Para que el CLI lea el `.env`, **siempre** tienes que invocarlo con `node --env-file=.env packages/cli/dist/index.js ...`. Es nativo de Node 22, sin dependencia extra (`dotenv` no se usa).

### 4.4 Verifica que todo está bien

```bash
node packages/cli/dist/index.js doctor
```

Deberías ver `ok` en `node`, `npm`, `git`. Las opcionales (`docker`, `gh`, `uv`) saldrán como `warn` si no las tienes — eso es fine.

---

## 5. Tu primer comando: `boiler doctor`

### 5.1 Qué hace

Imprime el estado de las herramientas que boilerX puede usar. Sin parámetros.

### 5.2 Uso

```bash
node packages/cli/dist/index.js doctor
```

### 5.3 Output esperado

```
boilerX :: doctor
───────────────────────────────────────────
  ok    node     v22.x
  ok    npm      11.x
  ok    git      git version 2.x
  ok    docker   Docker version 29.x
  warn  gh       (optional)              ← warn si no está, igual funciona el resto
  ok    uv       uv 0.x
```

### 5.4 Cuándo usarlo

- Cuando algo falla y quieres descartar "no tengo X instalado".
- Cuando llegas a una máquina nueva, antes de hacer cualquier otra cosa.
- En el primer paso de un onboarding para confirmar el entorno.

---

## 6. Crear un proyecto nuevo: `boiler new`

### 6.1 Sintaxis completa

```bash
node packages/cli/dist/index.js new <name> [opciones]
```

### 6.2 Opciones

| Flag | Default | Qué hace |
|---|---|---|
| `<name>` | (requerido) | Nombre del proyecto en kebab-case (`/^[a-z][a-z0-9-]{0,63}$/`) |
| `-s, --stack <kind>` | (interactivo) | `node-api` \| `node-web` \| `python-api` \| `python-cli` |
| `-y, --yes` | `false` | Skip prompts interactivos, asume defaults |
| `--no-git` | git on | No init git (hoy `boiler new` aún no inicializa git automáticamente, pero deja el flag listo) |
| `--no-docker` | docker on | Skip secciones Docker en templates |
| `--no-ci` | CI on | Skip secciones GH Actions en templates |
| `--evolve` | off | Activa scaffolding de Capa 2 (`.judge/`, `.evolve/`) |
| `--author <name>` | "boilerX user" | Autor para LICENSE y README |
| `--out <dir>` | cwd | Directorio padre donde crear el proyecto |

### 6.3 Ejemplo completo

```bash
node packages/cli/dist/index.js new mi-api \
  --stack node-api \
  --yes \
  --author "Carlos" \
  --out C:\Users\USER\Projects
```

### 6.4 Qué genera

8 archivos en `<out>/<name>/`:

```
mi-api/
├── .cursor/rules/project.mdc      # reglas de Cursor scopadas a este repo
├── .editorconfig                  # estilo cross-editor
├── .env.example                   # vars que el proyecto consume
├── .gitignore                     # filtrado por language=typescript
├── AGENTS.md                      # convenciones para agentes IA
├── LICENSE                        # MIT con tu autor + año
├── README.md                      # con badges, make targets, conventions
└── commitlint.config.cjs          # Conventional Commits enforcement
```

### 6.5 El motor de plantillas

Las plantillas son archivos en `packages/templates/_common/` (más adelante, `<stack>/` por stack).

- Si un archivo termina en `.hbs`, **su contenido se renderiza con Handlebars** y la extensión se quita en el output.
- Si **no** termina en `.hbs`, se copia tal cual (binarios, archivos con `{{ }}` legítimos como fixtures).
- Las **rutas** también se renderizan: `{{name}}/marker.txt` se convierte en `mi-api/marker.txt`.

Variables disponibles en templates: `name`, `stack`, `language`, `displayName`, `defaultPort`, `dockerEnabled`, `evolveEnabled`, `conventionalCommits`, `coverageThreshold`, `year`, `author`, etc.

Helpers disponibles en templates: `eq`, `neq`, `upper`, `lower`, `kebab`, `pascal`.

### 6.6 Estado actual de las plantillas

> **Hoy** cualquier `--stack` aplica solo `_common`. Las plantillas específicas (`node-api` con Fastify+Vitest+Docker, `python-api` con FastAPI+uv, etc.) llegan en Phase 4-5. Verás un mensaje:
>
> ```
> note: stack template 'node-api' not yet shipped — only _common applied.
> ```

Mientras tanto, si quieres estructura de proyecto real para probar Capa 2, puedes:

1. Correr `boiler new` para obtener el `_common`
2. Agregar manualmente `package.json`, `src/`, `test/` con el código del stack que prefieras
3. Crear el `.judge/metric.yaml`
4. Inicializar git y commitear

(Esto es exactamente lo que haremos en el caso de estudio, §12.)

### 6.7 Qué hacer después de `boiler new`

```bash
cd <name>
git init -b main
git add .
git commit -m "chore: initial scaffold"
```

(Phase 5 hará esto automáticamente.)

---

## 7. Probar el Judge solo: `boiler judge`

### 7.1 Por qué existe

Antes de gastar dinero en `boiler evolve`, querrás saber **qué score tiene tu proyecto AHORA**. `boiler judge` corre solo el Judge una vez sobre un proyecto y devuelve el verdict, sin Architect ni Workers. Es:

- **Gratis** (no llama a ningún LLM)
- **Rápido** (~1 segundo)
- **Útil para tunear `metric.yaml`**: si los pesos están mal o el comando de tests falla, lo ves aquí

### 7.2 Sintaxis

```bash
node packages/cli/dist/index.js judge --target <path> [opciones]
```

### 7.3 Opciones

| Flag | Default | Qué hace |
|---|---|---|
| `-t, --target <path>` | cwd | Proyecto a juzgar |
| `-m, --metric <file>` | `.judge/metric.yaml` | Path relativo al target |
| `-i, --iteration <n>` | `0` | Solo para logging |
| `--json` | off | Output como JSON puro (para `jq`/scripts) |

### 7.4 Ejemplo

```bash
node packages/cli/dist/index.js judge --target packages/evolve/tests/fixtures/sample-node-api
```

### 7.5 Output esperado

```
boilerX :: judge verdict
───────────────────────────────────────────
  score      0.8077
  hash       a64a19de5ffba0c7…

  breakdown
    tests        [████████████████████] 100.0%  (w=0.5)
    coverage     [████████████░░░░░░░░]  61.5%  (w=0.5)
    benchmark    [░░░░░░░░░░░░░░░░░░░░]   0.0%  (w=0)
    lint         [░░░░░░░░░░░░░░░░░░░░]   0.0%  (w=0)
    llm-judge    [░░░░░░░░░░░░░░░░░░░░]   0.0%  (w=0)
```

### 7.6 Interpretación del verdict

- **score**: número en `[0, 1]`. Es la suma ponderada de los axes.
- **hash**: SHA-256 del bundle del Judge (judgeVersion + metric.yaml + spec). Si lo ejecutas dos veces seguidas con el mismo `metric.yaml`, debe ser idéntico. Si cambia, alguien modificó el `metric.yaml`.
- **breakdown**: cada axis con su valor crudo y su peso en la suma.

### 7.7 Modo `--json`

Útil para integrar boilerX en otros scripts:

```bash
node ... judge --target . --json | jq '.score'
```

Devuelve el `JudgeVerdict` completo:

```json
{
  "score": 0.8077,
  "breakdown": { "testsPassing": 1, "coverageDelta": 0.6154, ... },
  "logs": "--- tests: `npm test` ...",
  "aborted": false,
  "judgeHash": "a64a19de…"
}
```

`logs` contiene el output crudo de cada comando ejecutado, truncado a 4000 chars por axis.

---

## 8. El loop completo: `boiler evolve`

### 8.1 Sintaxis completa

```bash
node --env-file=.env packages/cli/dist/index.js evolve --target <path> [opciones]
```

### 8.2 Opciones

| Flag | Default | Qué hace |
|---|---|---|
| `-t, --target <path>` | cwd | Proyecto a evolucionar |
| `-m, --metric <file>` | `.judge/metric.yaml` | Spec del Judge |
| `-i, --max-iterations <n>` | `5` | Hard cap de iteraciones |
| `-w, --workers <n>` | `2` | Workers en paralelo por iteración |
| `--max-cost-usd <usd>` | `1.00` | Hard cap de gasto en LLM (estimado) |
| `--max-wall-min <min>` | `30` | Hard cap de wall-clock |
| `--model <id>` | `composer-2` | Modelo del Cursor SDK |
| `--runtime <kind>` | `stub` | `stub` (sin LLM, gratis) o `cursor` (LLM real) |
| `--no-auto-apply` | apply on | NO commitear el ganador automáticamente (modo legacy) |

### 8.3 Pre-requisitos del repo target

1. Es un git repo con working tree **limpio** (commits pendientes ⇒ aborta).
2. Tiene un `.judge/metric.yaml` válido (pesos suman 1.0, comandos definidos).
3. Los comandos definidos en `metric.yaml` son ejecutables.
4. Para `--runtime cursor`: variable de entorno `CURSOR_API_KEY` cargada vía `--env-file=.env`.

### 8.4 Ejemplo: smoke run con stub (gratis)

```bash
node packages/cli/dist/index.js evolve \
  --target ./mi-proyecto \
  --runtime stub \
  --max-iterations 3 \
  --workers 2
```

Útil para validar que el `metric.yaml` está bien antes de gastar tokens.

### 8.5 Ejemplo: run real con LLM

```powershell
node --env-file=.env packages/cli/dist/index.js evolve `
  --target ./mi-proyecto `
  --runtime cursor `
  --model composer-2 `
  --max-iterations 5 `
  --workers 3 `
  --max-cost-usd 5.00 `
  --max-wall-min 20
```

### 8.6 Qué pasa por dentro, paso a paso

```
1. ensureLocalIgnore(".evolve")
   ↳ Escribe ".evolve" en .git/info/exclude del target.
     Garantiza que los runtime artifacts no causen "dirty tree".

2. RunLogger.create(runId, runDir)
   ↳ Abre <target>/.evolve/runs/<runId>.jsonl en append mode con fsync.

3. ensureBaseClean()
   ↳ git status --porcelain
   ↳ si NO está limpio: throw, run aborta antes de tocar nada.

4. judge.evaluate(target)
   ↳ Ejecuta testsCommand, coverageCommand, etc.
   ↳ Captura el judgeHash. Lo guardamos como "expected".
   ↳ Si verdict.judgeHash != expectedHash: abort (paranoia).
   ↳ Append "start" record al JSONL.

5. for i in [1..maxIterations]:
   a) Budget check (cost, iter, wall): si excede ⇒ abort record + break
   b) architect.proposeHypotheses(history, N)
      ↳ CursorArchitect llama Cursor SDK
      ↳ Parsea JSON con retry-on-malformed (default 1 retry)
      ↳ Filtra forbidden paths de affectedFiles
      ↳ Después: git checkout HEAD -- . && git clean -fd .
        (read-only enforcement)
      ↳ Devuelve { hypotheses, costUsd }
   c) for each hypothesis (en paralelo, Promise.all):
      ├─ worktrees.create(runId, hypId)         # git worktree add -b ...
      ├─ worker.apply(hypothesis, worktree)
      │  ├─ CursorWorker llama Cursor SDK
      │  ├─ El LLM edita archivos en el worktree
      │  ├─ Después: enforceFileFences()
      │  │   ├─ git status --porcelain
      │  │   ├─ revierte archivos fuera de affectedFiles
      │  │   └─ revierte forbidden paths siempre
      │  └─ devuelve { success, filesModified, costUsd, notes }
      ├─ judge.evaluate(worktree)
      │  ├─ verifica hash; drift ⇒ abort
      │  └─ devuelve verdict { score, breakdown, ... }
      └─ devuelve { hypothesis, worktree, verdict, costUsd }
   d) Pick best score across workers
   e) kept = best.score > runningBest
   f) Append "iteration" record al JSONL
   g) if kept and autoApplyWinner:
      ├─ worktrees.applyWorktreePatch(best.worktree, message)
      │  ├─ git -C worktree add -N .  (incluye untracked)
      │  ├─ git -C worktree diff --binary HEAD  (serializa)
      │  ├─ git -C base apply --3way <patch>    (replay)
      │  ├─ git -C base add -A
      │  └─ git -C base commit -c user.name=boilerx-evolve \
      │                       -c user.email=evolve@boilerx.local \
      │                       -m "feat(evolve): <summary> (iter=N, score=X.XXXX)"
      └─ El HEAD del base avanza por exactamente 1 commit.
   h) Cleanup TODOS los worktrees de esta iteración (incluyendo el ganador)

6. Append "end" record al JSONL.
7. log.close()
```

### 8.7 Output del summary final

```
boilerX :: evolve summary
───────────────────────────────────────────
  runId            run-1778107453503
  runtime          cursor
  model            composer-2
  started          2026-05-06T22:44:13.503Z
  ended            2026-05-06T22:45:52.187Z
  iterations       3
  best score       1.0000
  best iteration   1
  total cost       $0.0272

  log: <target>/.evolve/runs/run-1778107453503.jsonl
```

### 8.8 Costo: estimado, no autoritativo

El Cursor SDK no expone cost en su `RunResult` (verificado contra los tipos del SDK). boilerX **estima** el cost a partir del token-counting:

```
inputTokens  = ceil(prompt.length / 4)
outputTokens = ceil(response.length / 4)
totalUsd     = (inputTokens / 1M) × pricing.input
             + (outputTokens / 1M) × pricing.output
```

Errores de ±30% son normales (los tokenizers difieren, los thinking-tokens no se ven, los precios cambian). **Usa `--max-cost-usd` con margen** y reconcilia con tu dashboard de Cursor para ground truth.

Pricing default está en `packages/evolve/src/cost.ts`. Override por modelo via `BOILERX_PRICING` (env JSON):

```bash
BOILERX_PRICING='{"composer-2":{"inputPerMTokens":3.0,"outputPerMTokens":15.0}}'
```

---

## 9. Anatomía de `.judge/metric.yaml`

El archivo más importante de tu proyecto cuando uses Capa 2. Define **qué significa "mejor"** para el Judge.

### 9.1 Esquema completo

```yaml
weights:
  testsPassing:    0.40    # MUST sum to 1.0
  coverageDelta:   0.15
  benchmarkScore:  0.25
  lintScore:       0.10
  llmJudgeRubric:  0.10

testsCommand:    "npm test"                  # OBLIGATORIO
coverageCommand: "npm run coverage"          # OBLIGATORIO
benchmarkCommand: "npm run bench"            # opcional, requerido si benchmarkScore > 0
lintCommand:     "npm run lint"              # opcional, requerido si lintScore > 0
llmJudgeRubricPath: "rubric.md"              # opcional, requerido si llmJudgeRubric > 0

timeoutSeconds:  300
```

### 9.2 Reglas de validación

- Pesos deben sumar **exactamente 1.0** (tolerancia 1e-6).
- Si asignas peso > 0 a un axis sin su comando definido ⇒ error en arranque.
- `testsCommand` y `coverageCommand` siempre obligatorios.
- `timeoutSeconds` aplica por comando individual (no global).

### 9.3 Cómo se calcula cada axis

#### `testsPassing` — fracción de tests que pasan

Si `exitCode === 0` ⇒ **1.0**. Si no, parsea el output buscando estos patrones:

| Patrón | Tooling reconocido |
|---|---|
| `Tests: X passed, Y total` | jest |
| `X passing / Y failing` | mocha |
| `pass N / fail M` | node:test |
| `X/Y passed` | varios |

Si nada matchea → **0**.

#### `coverageDelta` — coverage absoluto

Busca:

- `All files \| 87.50 \|` (istanbul / node:test --experimental-test-coverage)
- `TOTAL ... 92%` (coverage.py)
- `coverage 73.4%` (genérico)

Devuelve `pct / 100`. Sin match → **0**.

> **Nota**: el campo se llama "Delta" pero en este Phase devuelve **absoluto**. Phase 5 lo convertirá en delta-vs-baseline real.

#### `benchmarkScore` — performance

**No adivina**. Solo si tu comando emite una línea exacta:

```
EVOLVE_BENCHMARK_SCORE=0.84
```

Sin esa línea → **0**. Esto es deliberado para evitar reward-hacking de números cualquiera del output.

Tu script de bench debe terminar con:

```js
process.stdout.write(`EVOLVE_BENCHMARK_SCORE=${score.toFixed(4)}\n`);
```

#### `lintScore` — limpieza

`1 - violations / maxViolations` (default `maxViolations = 50`). Reconoce:

- ESLint: `12 problems (`
- Ruff: `Found 3 errors`
- Biome: `5 errors`

Si `exitCode === 0` ⇒ **1**. Sin match en output con código no-cero ⇒ **0**.

#### `llmJudgeRubric` — opinión LLM

**No implementado aún** (Phase 5). Hoy siempre devuelve **0**.

### 9.4 Ejemplo mínimo (solo tests)

```yaml
weights:
  testsPassing: 1.0
  coverageDelta: 0.0
  benchmarkScore: 0.0
  lintScore: 0.0
  llmJudgeRubric: 0.0
testsCommand: "npm test"
coverageCommand: "npm test"   # se requiere; reusa testsCommand si no usas coverage
```

### 9.5 Ejemplo realista (tests + coverage + lint)

```yaml
weights:
  testsPassing: 0.4
  coverageDelta: 0.3
  benchmarkScore: 0.0
  lintScore: 0.3
  llmJudgeRubric: 0.0
testsCommand: "npm test"
coverageCommand: "npm run coverage"
lintCommand: "npm run lint"
timeoutSeconds: 60
```

---

## 10. Salvaguardas anti-Goodhart

Goodhart's law: *"cuando una métrica se vuelve un objetivo, deja de ser una buena métrica"*. boilerX previene varias formas comunes de cheating del LLM:

| Salvaguarda | Cómo |
|---|---|
| **Métrica composite** | Múltiples ejes evita que el agente optimice una dimensión a costa de las demás |
| **Judge hash inmutable** | SHA-256 de `judgeVersion + metric.yaml + spec` se valida en cada eval; drift ⇒ abort run completo |
| **Whitelist por hipótesis** | Worker NO puede escribir fuera de `affectedFiles`; todo lo demás se revierte |
| **Forbidden paths** | `.judge/`, `.evolve/`, `tests/judge/`, `.git/`, `.github/`, `Makefile` se revierten siempre, incluso si están en whitelist |
| **Architect read-only** | Cualquier file que el Architect escriba se revierte con `git checkout HEAD -- . && git clean -fd .` post-prompt |
| **ID sanitization** | runId/hypothesisId con caracteres shell-unsafe ⇒ throw |
| **Budget circuit breakers** | Hard caps en `--max-cost-usd`, `--max-iterations`, `--max-wall-min` |
| **Working tree cleanup** | Cada worktree se elimina al final de su iteración, sin importar el resultado |
| **Architect output parsing** | JSON malformado ⇒ retry una vez ⇒ si falla, devuelve `[]`, NO crashea |
| **Benchmark anti-guessing** | El parser solo acepta `EVOLVE_BENCHMARK_SCORE=X` literal; ignora otros números del output |

---

## 11. El JSONL de auditoría

Cada `boiler evolve` escribe `<target>/.evolve/runs/<runId>.jsonl`. Una línea = un record. Con `fsync` por escritura, así que un crash deja un prefijo parseable.

### 11.1 Tipos de records

#### `start` (siempre primero)

```json
{
  "type":"start",
  "timestamp":"2026-05-06T22:44:13.503Z",
  "runId":"run-1778107453503",
  "config":{"target":"...","metricFile":"...","maxIterations":3, ...},
  "judgeHash":"a64a19de…",
  "baselineScore":0.8077
}
```

#### `iteration` (0..N, una por iteración ejecutada)

```json
{
  "type":"iteration",
  "timestamp":"2026-05-06T22:44:53.657Z",
  "iteration":1,
  "hypothesisId":"h-0-0",
  "worktree":"<path>/.evolve/worktrees/iter-1/h-0-0",
  "score":1,
  "previousBest":0.8077,
  "kept":true,
  "reason":"score improved",
  "costUsd":0.0089
}
```

#### `abort` (0..1, solo si abortó)

```json
{
  "type":"abort",
  "timestamp":"...",
  "reason":"judge-hash-drift",
  "detail":"expected x, got y"
}
```

`reason` ∈ `judge-hash-drift` | `budget-cost` | `budget-iterations` | `budget-wall-time` | `user-cancelled` | `internal-error`.

#### `end` (siempre último, excepto si abortó duro)

```json
{
  "type":"end",
  "timestamp":"...",
  "bestScore":1,
  "bestIteration":1,
  "totalIterations":3,
  "totalCostUsd":0.0272
}
```

### 11.2 Cómo inspeccionar el log

```bash
# Listar runs
ls .evolve/runs/

# Ver el log entero (Linux/Mac)
cat .evolve/runs/run-XXXXX.jsonl | jq

# Ver iteraciones que mejoraron (PowerShell)
Get-Content .evolve/runs/run-XXXXX.jsonl |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.type -eq "iteration" -and $_.kept -eq $true }
```

### 11.3 La API programática

`@boilerx/evolve` exporta:

- `readRunLog(filePath): Promise<readonly RunRecord[]>` — parsea el JSONL completo, valida shapes.
- `summarizeRunLog(records): RunLogSummary` — colapsa a `{ bestScore, bestIteration, totalCostUsd, aborted, ... }`.

---

## 12. Caso de estudio: el experimento `demo-calc`

Este experimento real, ejecutado el 6 de mayo de 2026, demuestra el sistema de punta a punta. Lo puedes reproducir.

### 12.1 Setup del target

```bash
mkdir sandbox/demo-calc && cd sandbox/demo-calc
git init -b main
```

`package.json`:

```json
{
  "name": "demo-calc",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/calculator.test.mjs",
    "coverage": "node --test --experimental-test-coverage --test-reporter=spec test/calculator.test.mjs"
  }
}
```

`src/calculator.mjs` con 5 funciones: `add`, `subtract`, `multiply`, `divide`, `power` (con caso recursivo para exponentes negativos).

`test/calculator.test.mjs` con **solo 2 tests** (cobre `add` y `subtract`). `multiply`, `divide`, `power` quedan **sin cubrir**.

`.judge/metric.yaml`:

```yaml
weights:
  testsPassing: 0.5
  coverageDelta: 0.5
  benchmarkScore: 0.0
  lintScore: 0.0
  llmJudgeRubric: 0.0
testsCommand: "npm test"
coverageCommand: "npm run coverage"
timeoutSeconds: 60
```

### 12.2 Baseline

```bash
node packages/cli/dist/index.js judge --target sandbox/demo-calc
```

Verdict:

```
score      0.8077
breakdown:
  tests        100.0%  (w=0.5)
  coverage      61.5%  (w=0.5)
```

Tests passing al 100% × 0.5 = 0.5. Coverage al 61.5% × 0.5 = 0.3077. Total: **0.8077**.

### 12.3 Run completo

```powershell
node --env-file=.env packages/cli/dist/index.js evolve `
  --target sandbox/demo-calc `
  --runtime cursor `
  --model composer-2 `
  --max-iterations 3 `
  --workers 2 `
  --max-wall-min 15 `
  --max-cost-usd 1.50
```

### 12.4 Lo que pasó (trace del JSONL real)

```
start    baseline=0.8077   judgeHash=a64a19de…
iter 1   score=1.0000  kept=true   "score improved"           cost=$0.0089
iter 2   score=1.0000  kept=false  "score did not improve"    cost=$0.0080
iter 3   score=1.0000  kept=false  "score did not improve"    cost=$0.0103
end      bestScore=1.0000   bestIteration=1   total=$0.0272
```

**Tiempo total: 100 segundos. Costo total: $0.0272.**

### 12.5 Resultado: lo que escribió el agente

```
git log:
  c230c9b boilerx-evolve: feat(evolve): Ampliar pruebas a multiply, divide y power (iter=1, score=1.0000)
  8e634b3 Carlos:          chore: initial scaffold with calculator missing tests

Diff: test/calculator.test.mjs | 17 ++++++++++++++++-
        1 file changed, 16 insertions(+), 1 deletion(-)

Coverage final: 100% en todas las funciones
```

El test que escribió el agente:

```javascript
test("multiply: basic", () => {
  assert.equal(multiply(2, 3), 6);
});

test("divide: basic and division by zero", () => {
  assert.equal(divide(6, 2), 3);
  assert.throws(() => divide(1, 0), { message: "division by zero" });
});

test("power: zero, positive and negative exponents", () => {
  assert.equal(power(5, 0), 1);
  assert.equal(power(2, 3), 8);
  assert.equal(power(2, -2), 0.25);
});
```

Observaciones:

- ✅ Cubrió la rama `b === 0` de `divide` con `assert.throws`
- ✅ Cubrió las 3 ramas de `power` (cero, positivo, negativo recursivo)
- ✅ Tests significativos, no copy-paste superficial
- ✅ Commit message en español (el LLM detectó el contexto)

### 12.6 Lo que esto valida

1. ✅ Hash pinning del judge mantenido a través de 3 iteraciones
2. ✅ `kept=true` solo cuando el score mejora; `kept=false` cuando no hay mejora
3. ✅ Auto-apply commit solo en iter 1 (la única que mejoró)
4. ✅ Iteraciones 2 y 3 se ejecutaron pero NO contaminaron la historia con commits inútiles
5. ✅ Cost tracking real (lejos del cap)
6. ✅ Convención de commit `feat(evolve): <summary> (iter=N, score=X.XXXX)` con autor `boilerx-evolve`

---

## 13. Workflow típico de uso

Este es el camino recomendado para usar boilerX en un proyecto real, paso a paso.

### 13.1 Crear proyecto nuevo

```bash
node packages/cli/dist/index.js new mi-app --stack node-api --yes --out ..
cd ../mi-app
```

### 13.2 Inicializar git

```bash
git init -b main
git add .
git commit -m "chore: initial scaffold"
```

### 13.3 Escribir tu metric.yaml

```bash
mkdir .judge
# crea .judge/metric.yaml con tus pesos y comandos
```

### 13.4 Probar el Judge solo

```bash
node ../boilerx/packages/cli/dist/index.js judge --target .
```

Si el verdict no tiene sentido, ajusta el `metric.yaml` y vuelve a correr. **No avances al siguiente paso** hasta que el verdict refleje correctamente la calidad del proyecto.

### 13.5 Smoke run con stub (gratis)

```bash
node ../boilerx/packages/cli/dist/index.js evolve --target . --runtime stub --max-iterations 1
```

Esto verifica que toda la plomería funciona (ensureBaseClean, worktree create/remove, judge eval, JSONL write) sin gastar tokens.

### 13.6 Run real con LLM

```powershell
node --env-file=../boilerx/.env ../boilerx/packages/cli/dist/index.js evolve `
  --target . `
  --runtime cursor `
  --max-iterations 5 `
  --workers 2 `
  --max-cost-usd 1.00
```

### 13.7 Inspeccionar resultado

```bash
git log --author=boilerx-evolve
cat .evolve/runs/<runId>.jsonl
```

Si te gustan los commits del agente:

```bash
git push        # los empujas a origin
```

Si no:

```bash
git reset --hard HEAD~N    # los descartas (N = número de commits del agente)
```

Si quieres verlos como uno solo:

```bash
git rebase -i HEAD~N       # squash interactivo
```

---

## 14. Configuración por variables de entorno

| Variable | Default | Qué hace |
|---|---|---|
| `CURSOR_API_KEY` | (vacío) | API key del Cursor SDK. Requerido para `--runtime cursor` |
| `BOILERX_PRICING` | usa `DEFAULT_PRICING` | JSON override del pricing por modelo (ver §8.8) |
| `BOILERX_LOG_LEVEL` | `info` | Nivel de log del CLI (`debug`, `info`, `warn`, `error`) |
| `BOILERX_MAX_COST_USD` | (sin default) | Default para `--max-cost-usd` cuando se omite |

Ejemplo `.env`:

```bash
CURSOR_API_KEY=cursor_abc123…
BOILERX_PRICING={"composer-2":{"inputPerMTokens":3.0,"outputPerMTokens":15.0}}
BOILERX_LOG_LEVEL=info
```

> **Cómo se cargan**: `node --env-file=.env packages/cli/dist/index.js ...`. Es nativo de Node 22, sin dependencia `dotenv`.

---

## 15. Troubleshooting

| Síntoma | Causa | Fix |
|---|---|---|
| `Refusing to scaffold into '...': directory already exists` | Ya existe el target de `boiler new` | Elige otro nombre o borra el directorio |
| `Project name 'X' is invalid` | Nombre con mayúsculas/símbolos | Usa solo `[a-z0-9-]`, 1-64 chars, empieza con letra |
| `Base repo at ... has uncommitted changes` | Working tree del target sucio | `git stash` o commit antes de `evolve` |
| `Metric spec must be a YAML mapping at top level` | YAML mal formado | Verifica indentación, no uses tabs |
| `weights must sum to 1.0, got 0.95` | Suma incorrecta | Ajusta los pesos |
| `Metric spec assigns weight to 'X' but no 'Xcommand' is defined` | Weight > 0 sin su comando | O agrega el comando o pon weight 0 |
| `CURSOR_API_KEY is required for runtime=cursor` | No cargaste el .env | Usa `node --env-file=.env ...` |
| `judge-hash-drift` en el log | Algún proceso modificó `metric.yaml` mid-run | Run aborta; commitea cambios y re-run |
| `node --test test/` da MODULE_NOT_FOUND | Node necesita glob explícito | Usa `node --test test/*.test.mjs` |
| `total cost: $0.0000` con runtime=cursor | El run no llegó a llamar al SDK (probablemente abort temprano) | Mira el JSONL, busca el record `abort` |
| Tests con CRLF fallan en Windows | `git core.autocrlf` convierte LF→CRLF | Normaliza con `.replace(/\r\n/g, '\n')` o configura `core.autocrlf=false` |

---

## 16. Glosario

- **Architect**: agente (LLM o stub) que propone N hipótesis por iteración. Read-only sobre el código.
- **Worker**: agente (LLM o stub) que implementa **una** hipótesis en su propio worktree.
- **Judge**: componente determinístico (no LLM) que ejecuta los comandos del `metric.yaml` y devuelve un score numérico.
- **Orchestrator**: el que coordina el loop architect → workers → judge → keep/revert/log.
- **Hypothesis**: una propuesta de cambio con `summary`, `rationale` y `affectedFiles` (whitelist).
- **Worktree**: copia funcional adicional del repo Git, en una carpeta y rama distinta. boilerX crea uno por hipótesis.
- **Métrica composite**: suma ponderada de varios axes (`testsPassing`, `coverageDelta`, `benchmarkScore`, `lintScore`, `llmJudgeRubric`).
- **Hash del Judge**: SHA-256 sobre `judgeVersion + metric.yaml + spec`. Inmutable durante un run.
- **Drift**: cuando el hash del Judge cambia mid-run (síntoma de tampering). Aborta el run.
- **Goodhart's law**: "cuando una métrica se vuelve un objetivo, deja de ser una buena métrica".
- **Reward hacking**: optimizar la métrica de formas que no reflejan el objetivo real.
- **Whitelist**: lista cerrada de archivos que un worker puede modificar (`hypothesis.affectedFiles`).
- **Forbidden paths**: paths que ningún worker puede tocar, incluso si están en whitelist (`.judge/`, etc.).
- **Auto-apply**: el orchestrator hace `git apply` + `git commit` del worktree ganador en el base, default ON.
- **Conventional Commits**: convención `<type>(<scope>): <subject>`. `feat`, `fix`, `chore`, `docs`, etc.

---

## 17. Roadmap

| Phase | Capa 1 | Capa 2 |
|---|---|---|
| 0 ✅ | Monorepo + CLI esqueleto | Type interfaces (Judge, Architect, …) |
| 1 ✅ | gh integration + branch protection | LocalJudge con composite metric |
| 2 ✅ | _(deferred)_ | Worktrees + JSONL RunLogger + Orchestrator |
| 3 ✅ | Renderer + plantilla `_common` | CursorArchitect + CursorWorker (LLM real) |
| **4 🚧** | `node-api` template real | **Cost reporting ✅** + **Auto-apply winner ✅** + Docker sandbox |
| 5 | python-api + remaining stacks | LLM-as-judge + run dashboard + resume support |

---

> **Fin del manual.** Cuando boilerX agregue features nuevas, este documento se actualizará en el mismo PR. La versión más reciente está siempre en
> `docs/USER_GUIDE.md` del repo, https://github.com/Chisk1n/boilerx.
