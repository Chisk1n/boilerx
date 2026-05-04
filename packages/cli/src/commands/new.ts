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

export function registerNewCommand(program: Command, logger: Logger): void {
  program
    .command("new")
    .description("Scaffold a new project with full-SDLC defaults (Capa 1).")
    .argument("<name>", "Project name (kebab-case)")
    .option("-s, --stack <kind>", "Stack kind: " + STACK_KINDS.join(" | "))
    .option("-y, --yes", "Skip interactive prompts and use defaults", false)
    .option("--no-git", "Skip git init")
    .option("--no-docker", "Skip Dockerfile/compose")
    .option("--no-ci", "Skip GitHub Actions workflow")
    .option("--evolve", "Enable Capa-2 evolve scaffolding (.judge/, .evolve/)")
    .action(async (name: string, opts: NewOptions) => {
      const cfg = await resolveConfig(name, opts);
      logger.info("scaffold plan ready", { stack: cfg.stack, name: cfg.name });
      console.log("");
      console.log(pc.bold(pc.cyan(`boilerX :: scaffold preview`)));
      console.log(pc.dim("───────────────────────────────────────────"));
      console.log(`  ${pc.bold("name")}      ${cfg.name}`);
      console.log(`  ${pc.bold("stack")}     ${cfg.stack} (${STACK_DESCRIPTORS[cfg.stack].displayName})`);
      console.log(`  ${pc.bold("path")}      ${cfg.path}`);
      console.log(`  ${pc.bold("git")}       ${cfg.git.init ? "yes" : "no"}`);
      console.log(`  ${pc.bold("docker")}    ${cfg.docker.enabled ? "yes" : "no"}`);
      console.log(`  ${pc.bold("ci")}        ${cfg.ci.githubActions ? "github-actions" : "no"}`);
      console.log(`  ${pc.bold("evolve")}    ${cfg.evolve.enabled ? "enabled" : "disabled"}`);
      console.log("");
      console.log(
        pc.yellow(
          "[ Phase 0 ] Templates not yet generated — run materialization is wired in Phase 1.",
        ),
      );
      console.log(pc.dim("See packages/templates and docs/STACKS.md for the plan.\n"));
    });
}

interface NewOptions {
  readonly stack?: string;
  readonly yes?: boolean;
  readonly git?: boolean;
  readonly docker?: boolean;
  readonly ci?: boolean;
  readonly evolve?: boolean;
}

async function resolveConfig(name: string, opts: NewOptions): Promise<ProjectConfig> {
  const stack = await resolveStack(opts);
  const targetPath = `${process.cwd().replace(/\\/g, "/")}/${name}`;

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
    throw new Error(
      `Unknown stack '${opts.stack}'. Valid: ${STACK_KINDS.join(", ")}`,
    );
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
