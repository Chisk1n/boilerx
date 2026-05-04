import { execSync } from "node:child_process";
import type { Command } from "commander";
import pc from "picocolors";
import type { Logger } from "@boilerx/shared";

export function registerDoctorCommand(program: Command, logger: Logger): void {
  program
    .command("doctor")
    .description("Check that required tools are installed (git, docker, gh, node).")
    .action(() => {
      logger.info("doctor invoked");
      console.log("");
      console.log(pc.bold(pc.green("boilerX :: doctor")));
      console.log(pc.dim("───────────────────────────────────────────"));
      check("node", "node --version");
      check("npm", "npm --version");
      check("git", "git --version");
      check("docker", "docker --version", { optional: true });
      check("gh", "gh --version", { optional: true });
      check("uv", "uv --version", { optional: true });
      console.log("");
    });
}

interface CheckOptions {
  readonly optional?: boolean;
}

function check(name: string, cmd: string, opts: CheckOptions = {}): void {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const head = out.split(/\r?\n/)[0] ?? out;
    console.log(`  ${pc.green("ok")}    ${name.padEnd(8)} ${pc.dim(head)}`);
  } catch {
    const tag = opts.optional ? pc.yellow("warn") : pc.red("missing");
    const note = opts.optional ? "(optional)" : "(required)";
    console.log(`  ${tag}  ${name.padEnd(8)} ${pc.dim(note)}`);
  }
}
