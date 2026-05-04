// Trivial "linter" stub: scans .mjs files for forbidden patterns and prints
// an ESLint-style summary that parsers.parseLintResult understands.
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const FORBIDDEN = [/console\.log\(/g, /TODO[: ]/g];

const EXCLUDED_DIRS = new Set(["node_modules", ".judge", "scripts"]);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.name.endsWith(".mjs") || e.name.endsWith(".js")) {
      yield p;
    }
  }
}

let violations = 0;
for await (const file of walk(root)) {
  const s = await stat(file);
  if (!s.isFile()) continue;
  const content = await readFile(file, "utf8");
  for (const pat of FORBIDDEN) {
    const m = content.match(pat);
    if (m) violations += m.length;
  }
}

if (violations === 0) {
  console.log("lint clean");
  process.exit(0);
} else {
  console.log(`\u2716 ${violations} problems (eslint-style)`);
  process.exit(1);
}
