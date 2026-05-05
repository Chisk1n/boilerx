import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import type { Command } from "commander";
import pc from "picocolors";
import prompts from "prompts";
import {
  DEFAULT_PROJECT_CONFIG,
  STACK_DESCRIPTORS,
  STACK_KINDS,
  isStackKind,
  type Logger,
  type ProjectConfig,
  type StackKind,
} from "@boilerx/shared";
import { buildTemplateVars, renderTemplates } from "../renderer/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerNewCommand(program: Command, logger: Logger): void {
  program
    .command("new")
    .description("Scaffold a new project with full-SDLC defaults (Capa 1).")
    .argument("<name>", "Project name (kebab-case)")
    .option("-s, --stack <kind>", "Stack kind: " + STACK_KINDS.join(" | "))
    .option("-y, --yes", "Skip interactive prompts and use defaults", false)
    .option("--no-git", "Skip git init", false)
    .option("--no-docker", "Skip Dockerfile/compose")
    .option("--no-ci", "Skip GitHub Actions workflow")
    .option("--evolve", "Enable Capa-2 evolve scaffolding (.judge/, .evolve/)")
    .option("--author <name>", "Author name embedded in LICENSE and README")
    .option("--out <dir>", "Parent directory for the new project (default: cwd)")
    .action(async (name: string, opts: NewOptions) => {
      validateName(name);
      const cfg = await resolveConfig(name, opts);

      const targetDir = resolvePath(cfg.path);
      await refuseIfDirExists(targetDir);

      logger.info("scaffold starting", { stack: cfg.stack, name: cfg.name, path: targetDir });
      printPreview(cfg);

      const vars = buildTemplateVars({ project: cfg, author: opts.author });

      const templatesDir = locateTemplatesDir();
      const commonRoot = resolvePath(templatesDir, "_common");
      const stackRoot = resolvePath(templatesDir, cfg.stack);

      const stackExists = await pathExists(stackRoot);
      const roots = stackExists ? [commonRoot, stackRoot] : [commonRoot];

      const report = await renderTemplates({
        templateRoots: roots,
        destRoot: targetDir,
        vars,
        logger,
      });

      console.log("");
      console.log(pc.green(`  rendered ${report.filesRendered.length} templates`));
      console.log(pc.green(`  copied   ${report.filesCopied.length} files`));
      if (!stackExists) {
        console.log(
          pc.yellow(
            `  note: stack template '${cfg.stack}' not yet shipped — only _common applied. ` +
              `node-api lands in PR #5.`,
          ),
        );
      }
      console.log("");
      console.log(pc.bold(pc.cyan(`  cd ${cfg.name}`)));
      console.log("");
    });
}

interface NewOptions {
  readonly stack?: string;
  readonly yes?: boolean;
  readonly git?: boolean;
  readonly docker?: boolean;
  readonly ci?: boolean;
  readonly evolve?: boolean;
  readonly author?: string;
  readonly out?: string;
}

function validateName(name: string): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(
      `Project name '${name}' is invalid. Use lowercase letters, digits, and '-' (1-64 chars, must start with a letter).`,
    );
  }
}

async function refuseIfDirExists(target: string): Promise<void> {
  try {
    const s = await stat(target);
    if (s.isDirectory()) {
      throw new Error(
        `Refusing to scaffold into '${target}': directory already exists. Pick a different name or remove it first.`,
      );
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function locateTemplatesDir(): string {
  return resolvePath(__dirname, "..", "..", "..", "templates");
}

async function resolveConfig(name: string, opts: NewOptions): Promise<ProjectConfig> {
  const stack = await resolveStack(opts);
  const parent = opts.out ? resolvePath(opts.out) : process.cwd();
  const targetPath = resolvePath(parent, name);

  return {
    name,
    stack,
    path: targetPath,
    git: { ...DEFAULT_PROJECT_CONFIG.git, init: opts.git !== false },
    docker: { ...DEFAULT_PROJECT_CONFIG.docker, enabled: opts.docker !== false },
    ci: { ...DEFAULT_PROJECT_CONFIG.ci, githubActions: opts.ci !== false },
    evolve: { ...DEFAULT_PROJECT_CONFIG.evolve, enabled: opts.evolve === true },
  };
}

async function resolveStack(opts: NewOptions): Promise<StackKind> {
  if (opts.stack && isStackKind(opts.stack)) return opts.stack;
  if (opts.stack) {
    throw new Error(`Unknown stack '${opts.stack}'. Valid: ${STACK_KINDS.join(", ")}`);
  }
  if (opts.yes) return "node-api";

  const response = await prompts({
    type: "select",
    name: "stack",
    message: "Choose a stack",
    choices: STACK_KINDS.map((k) => ({
      title: STACK_DESCRIPTORS[k].displayName,
      value: k,
      description: STACK_DESCRIPTORS[k].description,
    })),
    initial: 0,
  });
  if (!response.stack) {
    throw new Error("Stack selection cancelled.");
  }
  return response.stack as StackKind;
}

function printPreview(cfg: ProjectConfig): void {
  console.log("");
  console.log(pc.bold(pc.cyan("boilerX :: scaffold")));
  console.log(pc.dim("───────────────────────────────────────────"));
  console.log(`  ${pc.bold("name")}      ${cfg.name}`);
  console.log(`  ${pc.bold("stack")}     ${cfg.stack} (${STACK_DESCRIPTORS[cfg.stack].displayName})`);
  console.log(`  ${pc.bold("path")}      ${cfg.path}`);
  console.log(`  ${pc.bold("docker")}    ${cfg.docker.enabled ? "yes" : "no"}`);
  console.log(`  ${pc.bold("ci")}        ${cfg.ci.githubActions ? "github-actions" : "no"}`);
  console.log(`  ${pc.bold("evolve")}    ${cfg.evolve.enabled ? "enabled" : "disabled"}`);
  console.log("");
}
