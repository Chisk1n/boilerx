import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, DEFAULT_PROJECT_CONFIG } from "@boilerx/shared";
import { buildTemplateVars, renderTemplates } from "../src/renderer/index.js";

const SILENT = createLogger({ level: "error" });

const baseProject = {
  name: "demo-app",
  stack: "node-api" as const,
  path: "/will-be-overridden",
  ...DEFAULT_PROJECT_CONFIG,
};

describe("renderTemplates", () => {
  let tplDir: string;
  let outDir: string;

  beforeEach(async () => {
    tplDir = await mkdtemp(join(tmpdir(), "boilerx-tpl-"));
    outDir = await mkdtemp(join(tmpdir(), "boilerx-out-"));
  });
  afterEach(async () => {
    await rm(tplDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  });

  it("renders .hbs files with vars and strips the extension", async () => {
    await writeFile(join(tplDir, "README.md.hbs"), "# {{name}}\n\nLang: {{language}}\n");
    const vars = buildTemplateVars({ project: baseProject });
    const report = await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars,
      logger: SILENT,
    });
    const out = await readFile(join(outDir, "README.md"), "utf8");
    expect(out).toBe("# demo-app\n\nLang: typescript\n");
    expect(report.filesRendered).toEqual(["README.md"]);
    expect(report.filesCopied).toEqual([]);
  });

  it("copies non-.hbs files verbatim", async () => {
    await writeFile(join(tplDir, ".editorconfig"), "indent_style = space\n");
    const report = await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    const out = await readFile(join(outDir, ".editorconfig"), "utf8");
    expect(out).toBe("indent_style = space\n");
    expect(report.filesCopied).toEqual([".editorconfig"]);
    expect(report.filesRendered).toEqual([]);
  });

  it("renders directory names containing {{vars}}", async () => {
    await mkdir(join(tplDir, "{{name}}"), { recursive: true });
    await writeFile(join(tplDir, "{{name}}", "marker.txt"), "ok\n");
    await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    const out = await readFile(join(outDir, "demo-app", "marker.txt"), "utf8");
    expect(out).toBe("ok\n");
  });

  it("supports {{#if}} conditionals via the vars object", async () => {
    await writeFile(
      join(tplDir, "doc.md.hbs"),
      "head\n{{#if dockerEnabled}}docker yes{{else}}docker no{{/if}}\ntail",
    );
    const dockerOn = await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    expect(dockerOn).toBeDefined();
    let out = await readFile(join(outDir, "doc.md"), "utf8");
    expect(out).toContain("docker yes");

    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const customProject = {
      ...baseProject,
      docker: { ...baseProject.docker, enabled: false },
    };
    await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: customProject }),
      logger: SILENT,
    });
    out = await readFile(join(outDir, "doc.md"), "utf8");
    expect(out).toContain("docker no");
  });

  it("supports the eq helper for stack-specific branches", async () => {
    await writeFile(
      join(tplDir, "lang.md.hbs"),
      "{{#if (eq language \"typescript\")}}TS!{{/if}}{{#if (eq language \"python\")}}PY!{{/if}}",
    );
    await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    const out = await readFile(join(outDir, "lang.md"), "utf8");
    expect(out).toBe("TS!");
  });

  it("layered roots: later root overwrites earlier root at same relative path", async () => {
    const tpl2 = await mkdtemp(join(tmpdir(), "boilerx-tpl2-"));
    try {
      await writeFile(join(tplDir, "README.md.hbs"), "from common: {{name}}\n");
      await writeFile(join(tpl2, "README.md.hbs"), "from stack: {{name}}\n");
      await writeFile(join(tplDir, "common-only.txt"), "only in common\n");
      await writeFile(join(tpl2, "stack-only.txt"), "only in stack\n");

      await renderTemplates({
        templateRoots: [tplDir, tpl2],
        destRoot: outDir,
        vars: buildTemplateVars({ project: baseProject }),
        logger: SILENT,
      });

      expect(await readFile(join(outDir, "README.md"), "utf8")).toBe("from stack: demo-app\n");
      expect(await readFile(join(outDir, "common-only.txt"), "utf8")).toBe("only in common\n");
      expect(await readFile(join(outDir, "stack-only.txt"), "utf8")).toBe("only in stack\n");
    } finally {
      await rm(tpl2, { recursive: true, force: true });
    }
  });

  it("never renders content of non-.hbs files even if they contain {{ }}", async () => {
    await writeFile(join(tplDir, "fixture.json"), `{"placeholder": "{{name}}"}\n`);
    await renderTemplates({
      templateRoots: [tplDir],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    const out = await readFile(join(outDir, "fixture.json"), "utf8");
    expect(out).toBe(`{"placeholder": "{{name}}"}\n`);
  });

  it("missing template root is silently skipped (other roots still apply)", async () => {
    await writeFile(join(tplDir, "kept.txt.hbs"), "{{name}}\n");
    await renderTemplates({
      templateRoots: [tplDir, join(tmpdir(), "this-root-does-not-exist-zzz")],
      destRoot: outDir,
      vars: buildTemplateVars({ project: baseProject }),
      logger: SILENT,
    });
    const out = await readFile(join(outDir, "kept.txt"), "utf8");
    expect(out).toBe("demo-app\n");
  });
});

describe("buildTemplateVars", () => {
  it("expands ProjectConfig into the documented surface", () => {
    const vars = buildTemplateVars({
      project: baseProject,
      author: "Alice",
      now: () => new Date("2026-05-04T00:00:00Z"),
    });
    expect(vars.name).toBe("demo-app");
    expect(vars.stack).toBe("node-api");
    expect(vars.language).toBe("typescript");
    expect(vars.defaultPort).toBe(3000);
    expect(vars.author).toBe("Alice");
    expect(vars.year).toBe(2026);
    expect(vars.coverageThreshold).toBe(80);
    expect(vars.evolveEnabled).toBe(false);
  });

  it("uses 'boilerX user' when no author is provided", () => {
    const vars = buildTemplateVars({ project: baseProject });
    expect(vars.author).toBe("boilerX user");
  });
});
