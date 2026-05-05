import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "@boilerx/evolve";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CLI_ENTRY = resolve(REPO_ROOT, "packages", "cli", "dist", "index.js");

describe("`boiler new` end-to-end", () => {
  let outParent: string;

  beforeEach(async () => {
    outParent = await mkdtemp(join(tmpdir(), "boilerx-new-e2e-"));
  });
  afterEach(async () => {
    await rm(outParent, { recursive: true, force: true });
  });

  it("scaffolds a project with the _common template and substitutes vars", async () => {
    const result = await runCommand(
      `node "${CLI_ENTRY}" new my-test-app --stack node-api --yes --no-ci --no-docker --author "Test Author" --out "${outParent}"`,
      { cwd: REPO_ROOT, timeoutMs: 30_000 },
    );

    expect(result.exitCode).toBe(0);

    const projectDir = join(outParent, "my-test-app");
    const exists = await stat(projectDir);
    expect(exists.isDirectory()).toBe(true);

    const readme = await readFile(join(projectDir, "README.md"), "utf8");
    expect(readme).toContain("# my-test-app");
    expect(readme).toContain("Node API");

    const license = await readFile(join(projectDir, "LICENSE"), "utf8");
    expect(license).toContain("Test Author");
    expect(license).toMatch(/Copyright \(c\) \d{4}/);

    const agents = await readFile(join(projectDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("`node-api`");
    expect(agents).toContain("Conventional Commits");

    const gitignore = await readFile(join(projectDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).not.toContain("__pycache__/");

    const cursorRules = await readFile(
      join(projectDir, ".cursor", "rules", "project.mdc"),
      "utf8",
    );
    expect(cursorRules).toContain("my-test-app");

    const editorconfig = await readFile(join(projectDir, ".editorconfig"), "utf8");
    expect(editorconfig).toContain("root = true");

    const commitlint = await readFile(join(projectDir, "commitlint.config.cjs"), "utf8");
    expect(commitlint).toContain("@commitlint/config-conventional");
  }, 30_000);

  it("refuses to overwrite an existing directory", async () => {
    await runCommand(
      `node "${CLI_ENTRY}" new collide --stack node-api --yes --out "${outParent}"`,
      { cwd: REPO_ROOT, timeoutMs: 30_000 },
    );
    const second = await runCommand(
      `node "${CLI_ENTRY}" new collide --stack node-api --yes --out "${outParent}"`,
      { cwd: REPO_ROOT, timeoutMs: 30_000 },
    );
    expect(second.exitCode).not.toBe(0);
    expect(second.stdout + second.stderr).toMatch(/already exists/);
  }, 60_000);

  it("rejects invalid project names", async () => {
    const result = await runCommand(
      `node "${CLI_ENTRY}" new BadName --stack node-api --yes --out "${outParent}"`,
      { cwd: REPO_ROOT, timeoutMs: 30_000 },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/invalid/i);
  });

  it("rejects unknown stacks", async () => {
    const result = await runCommand(
      `node "${CLI_ENTRY}" new ok-name --stack made-up --yes --out "${outParent}"`,
      { cwd: REPO_ROOT, timeoutMs: 30_000 },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Unknown stack/);
  });
});
