#!/usr/bin/env node
/**
 * Convert a Markdown document into a PDF without third-party headless
 * runtimes by piping the Markdown through `marked` and feeding the resulting
 * HTML to a system browser running in `--headless --print-to-pdf` mode.
 *
 * Looks for browsers in this order:
 *   1. $BOILERX_BROWSER (full path)
 *   2. msedge.exe (Windows: Edge ships with the OS)
 *   3. chrome.exe
 *
 * Usage:
 *   node scripts/build-pdf.mjs <input.md> <output.pdf>
 *
 * Defaults to docs/USER_GUIDE.md → docs/USER_GUIDE.pdf when called with no
 * arguments, so `npm run docs:pdf` is a one-liner.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const inputArg = process.argv[2] ?? "docs/USER_GUIDE.md";
const outputArg = process.argv[3] ?? "docs/USER_GUIDE.pdf";

const inputPath = resolve(repoRoot, inputArg);
const outputPath = resolve(repoRoot, outputArg);

if (!existsSync(inputPath)) {
  console.error(`[build-pdf] input not found: ${inputPath}`);
  process.exit(1);
}

const browser = await locateBrowser();
if (!browser) {
  console.error(
    "[build-pdf] No browser found. Set BOILERX_BROWSER to a Chrome/Edge .exe path,",
  );
  console.error("            or install Edge/Chrome.");
  process.exit(1);
}

console.log(`[build-pdf] using browser: ${browser}`);
console.log(`[build-pdf] reading:       ${inputPath}`);

const md = await readFile(inputPath, "utf8");

marked.setOptions({ gfm: true, breaks: false, headerIds: true });
const body = marked.parse(md);
const html = renderHtml(body, inputPath);

const tmp = await mkdtemp(join(tmpdir(), "boilerx-pdf-"));
const htmlPath = join(tmp, "doc.html");
await writeFile(htmlPath, html, "utf8");
console.log(`[build-pdf] HTML at:       ${htmlPath}`);

await runBrowser(browser, htmlPath, outputPath);
console.log(`[build-pdf] PDF written:   ${outputPath}`);

try {
  await rm(tmp, { recursive: true, force: true });
} catch {
  // ignore tmp cleanup failures
}

async function locateBrowser() {
  const env = process.env.BOILERX_BROWSER;
  if (env && existsSync(env)) return env;

  const candidates = [
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function runBrowser(browserPath, htmlPath, pdfPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const url = "file:///" + htmlPath.replace(/\\/g, "/");
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      "--virtual-time-budget=10000",
      `--print-to-pdf=${pdfPath}`,
      url,
    ];
    const child = spawn(browserPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      if (code !== 0 && !existsSync(pdfPath)) {
        rejectPromise(
          new Error(`browser exited with code ${code}\n${stderr.slice(-1000)}`),
        );
        return;
      }
      resolvePromise();
    });
    child.on("error", rejectPromise);
  });
}

function renderHtml(bodyHtml, sourcePath) {
  const generatedAt = new Date().toISOString();
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>boilerX — Manual de usuario</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm;
    }
    :root {
      --fg: #1f2328;
      --muted: #6e7781;
      --bg: #ffffff;
      --accent: #0969da;
      --code-bg: #f6f8fa;
      --border: #d0d7de;
      --table-stripe: #f6f8fa;
    }
    * { box-sizing: border-box; }
    html, body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.55;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4, h5, h6 {
      color: var(--fg);
      page-break-after: avoid;
      line-height: 1.25;
    }
    h1 {
      font-size: 22pt;
      border-bottom: 2px solid var(--border);
      padding-bottom: 6pt;
      margin-top: 18pt;
    }
    h2 {
      font-size: 16pt;
      border-bottom: 1px solid var(--border);
      padding-bottom: 4pt;
      margin-top: 22pt;
      page-break-before: auto;
    }
    h3 { font-size: 13pt; margin-top: 16pt; }
    h4 { font-size: 11.5pt; margin-top: 12pt; }
    p, ul, ol { margin: 6pt 0; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: var(--code-bg);
      border-radius: 3px;
      padding: 1px 4px;
      font-family: "Cascadia Code", "Consolas", "Menlo", monospace;
      font-size: 9.5pt;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 9pt 11pt;
      overflow-x: auto;
      page-break-inside: avoid;
      font-size: 9.25pt;
      line-height: 1.4;
    }
    pre code {
      background: transparent;
      padding: 0;
      font-size: 9.25pt;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 8pt 0;
      font-size: 10pt;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 5pt 8pt;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--code-bg);
      font-weight: 600;
    }
    tr:nth-child(even) td { background: var(--table-stripe); }
    blockquote {
      margin: 8pt 0;
      padding: 6pt 12pt;
      border-left: 3px solid var(--accent);
      background: #f6f8fa;
      color: var(--muted);
    }
    blockquote p { margin: 4pt 0; }
    hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 16pt 0;
    }
    .cover {
      page-break-after: always;
      padding: 60pt 0;
      text-align: center;
    }
    .cover .title {
      font-size: 36pt;
      font-weight: 700;
      letter-spacing: -0.5pt;
    }
    .cover .subtitle {
      font-size: 14pt;
      color: var(--muted);
      margin-top: 12pt;
    }
    .cover .meta {
      font-size: 10pt;
      color: var(--muted);
      margin-top: 28pt;
      font-family: "Cascadia Code", "Consolas", monospace;
    }
    .footer-note {
      color: var(--muted);
      font-size: 9pt;
      text-align: center;
      margin-top: 24pt;
      padding-top: 12pt;
      border-top: 1px solid var(--border);
    }
    /* Suppress the auto-rendered top-level h1 since the cover handles it */
    main > h1:first-child { display: none; }
  </style>
</head>
<body>
  <div class="cover">
    <div class="title">boilerX</div>
    <div class="subtitle">Manual de usuario</div>
    <div class="meta">
      generado: ${generatedAt}<br />
      fuente: ${sourcePath.replace(repoRoot, "&lt;repo&gt;").replace(/\\/g, "/")}
    </div>
  </div>
  <main>
    ${bodyHtml}
  </main>
  <div class="footer-note">
    boilerX user guide — generado desde Markdown vía marked + browser headless print.
  </div>
</body>
</html>`;
}
