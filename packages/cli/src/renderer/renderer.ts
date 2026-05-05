import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import Handlebars from "handlebars";
import type { Logger } from "@boilerx/shared";
import type { TemplateVars } from "./vars.js";

export interface RenderOptions {
  readonly templateRoots: readonly string[];
  readonly destRoot: string;
  readonly vars: TemplateVars;
  readonly logger: Logger;
  readonly overwrite?: boolean;
}

export interface RenderReport {
  readonly filesRendered: readonly string[];
  readonly filesCopied: readonly string[];
  readonly skipped: readonly string[];
}

const HBS_EXT = ".hbs";

/**
 * Walks a list of template roots in order and materializes them into
 * `destRoot`, applying handlebars to:
 *
 *   1. file contents that end in `.hbs` (extension stripped on output)
 *   2. every path component, so directories like `{{name}}/` work
 *
 * Files without `.hbs` are copied verbatim — useful for binaries and files
 * that legitimately contain `{{ … }}` (e.g. test fixtures).
 *
 * Multiple roots overlay: later roots overwrite earlier ones at the same
 * relative path. This is how `_common` provides defaults that a
 * stack-specific template can override.
 */
export async function renderTemplates(opts: RenderOptions): Promise<RenderReport> {
  const log = opts.logger.child({ component: "renderer" });
  const dest = resolve(opts.destRoot);

  registerHelpers();
  const compiledPathCache = new Map<string, Handlebars.TemplateDelegate>();

  const filesRendered: string[] = [];
  const filesCopied: string[] = [];
  const skipped: string[] = [];

  await mkdir(dest, { recursive: true });

  for (const root of opts.templateRoots) {
    const absRoot = resolve(root);
    log.debug("layering template root", { root: absRoot });
    for await (const file of walk(absRoot)) {
      const rel = relative(absRoot, file);
      const renderedRel = renderPath(rel, opts.vars, compiledPathCache);
      const isHbs = renderedRel.endsWith(HBS_EXT);
      const finalRel = isHbs ? renderedRel.slice(0, -HBS_EXT.length) : renderedRel;
      const finalPath = join(dest, finalRel);

      await mkdir(dirname(finalPath), { recursive: true });

      if (isHbs) {
        const raw = await readFile(file, "utf8");
        const tpl = Handlebars.compile(raw, { noEscape: true, strict: false });
        const rendered = tpl(opts.vars);
        await writeFile(finalPath, rendered, "utf8");
        filesRendered.push(finalRel);
      } else {
        await copyFile(file, finalPath);
        filesCopied.push(finalRel);
      }
    }
  }

  return { filesRendered, filesCopied, skipped };
}

function renderPath(
  rel: string,
  vars: TemplateVars,
  cache: Map<string, Handlebars.TemplateDelegate>,
): string {
  if (!rel.includes("{{")) return rel;
  let tpl = cache.get(rel);
  if (!tpl) {
    tpl = Handlebars.compile(rel, { noEscape: true, strict: false });
    cache.set(rel, tpl);
  }
  return tpl(vars).split("/").join(sep);
}

async function* walk(root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

let helpersRegistered = false;

function registerHelpers(): void {
  if (helpersRegistered) return;
  helpersRegistered = true;

  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper("neq", (a: unknown, b: unknown) => a !== b);
  Handlebars.registerHelper("upper", (s: unknown) => String(s ?? "").toUpperCase());
  Handlebars.registerHelper("lower", (s: unknown) => String(s ?? "").toLowerCase());
  Handlebars.registerHelper("kebab", (s: unknown) =>
    String(s ?? "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase(),
  );
  Handlebars.registerHelper("pascal", (s: unknown) =>
    String(s ?? "")
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(""),
  );
}
