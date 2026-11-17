#!/usr/bin/env node
/**
 * Build the static site that gets published to GitHub Pages (or any static
 * host). Run AFTER `npm run daily` has produced today's report.
 *
 * Writes into daily_reports/ (already the publish dir):
 *   - index.html      copy of the latest <date>/<date>.html
 *   - archive.html    table of every <date>/<date>.html, newest first
 *
 * Existing per-date subdirs are left untouched. Idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/build-site.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = "daily_reports";

if (!fs.existsSync(ROOT)) {
  console.error(`[build-site] ${ROOT}/ doesn't exist — run \`npm run daily\` first.`);
  process.exit(1);
}

// Pick up every <YYYY-MM-DD>/<YYYY-MM-DD>.html, newest first.
const dates = fs
  .readdirSync(ROOT)
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .filter((d) => fs.existsSync(path.join(ROOT, d, `${d}.html`)))
  .sort((a, b) => b.localeCompare(a));

if (dates.length === 0) {
  console.error(`[build-site] no <YYYY-MM-DD>/<YYYY-MM-DD>.html found in ${ROOT}/`);
  process.exit(1);
}

// --- index.html = latest report ---
const latest = dates[0];
const latestPath = path.join(ROOT, latest, `${latest}.html`);
const latestHtml = fs
  .readFileSync(latestPath, "utf8")
  .replace(/href="\.\.\/archive\.html"/g, 'href="./archive.html"')
  // Fragments sit inside the dated directory, so the copy at the root carries it.
  .replace(
    new RegExp(`data-src="${latest}-overflow/`, "g"),
    `data-src="./${latest}/${latest}-overflow/`,
  );

// A missing fragment shows up as "load failed" only after the reader scrolls.
for (const [, src] of latestHtml.matchAll(/data-src="([^"]+)"/g)) {
  if (!fs.existsSync(path.join(ROOT, src))) {
    console.error(`[build-site] index.html points at a missing fragment: ${src}`);
    process.exit(1);
  }
}

fs.writeFileSync(path.join(ROOT, "index.html"), latestHtml, "utf8");
console.log(`[build-site] index.html  ← ${latest}/${latest}.html`);

// --- archive.html = list of all reports ---
const rows = dates
  .map((d) => {
    const size = (fs.statSync(path.join(ROOT, d, `${d}.html`)).size / 1024).toFixed(0);
    return `      <li><a href="./${d}/${d}.html">${d}</a> <span class="size">${size} KB</span></li>`;
  })
  .join("\n");

const archiveHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>daily-brief — archive</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  // Same theme key as the report & admin pages so one choice applies everywhere.
  (function () {
    var t = "light";
    try { t = localStorage.getItem("db-report-theme") || ""; } catch (e) {}
    if (t !== "light" && t !== "dark" && t !== "paper") {
      t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", t);
  })();
</script>
<style>
  :root, html[data-theme="light"] {
    color-scheme: light;
    --bg: #f6f7fa; --bg-elevated: #ffffff; --bg-subtle: #eef1f6;
    --fg: #14181f; --muted: #6b7482; --rule: #e1e6ed;
    --link: #3454d1; --accent: #3454d1; --accent-fg: #ffffff;
    --shadow: 0 1px 2px rgba(20,24,31,.04), 0 4px 14px rgba(20,24,31,.03);
    --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  html[data-theme="dark"] {
    color-scheme: dark;
    --bg: #0d1117; --bg-elevated: #161b23; --bg-subtle: #1c222c;
    --fg: #e9eef6; --muted: #8d97a7; --rule: #29313c;
    --link: #8aabff; --accent: #7196ff; --accent-fg: #0d1117;
    --shadow: 0 1px 2px rgba(0,0,0,.3);
  }
  html[data-theme="paper"] {
    color-scheme: light;
    --bg: #f2ecdf; --bg-elevated: #fffcf4; --bg-subtle: #eae1cf;
    --fg: #2c271f; --muted: #817663; --rule: #ddd2bb;
    --link: #8a4b20; --accent: #8a4b20; --accent-fg: #fffcf4;
    --shadow: none;
    --font-body: Georgia, "Songti SC", "STSong", "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: var(--font-body); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
  .toolbar { display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap; margin-bottom: 1.6rem; }
  .brand { display: flex; align-items: center; gap: 9px; }
  .brand-mark { display: inline-block; width: 17px; height: 17px; border-radius: 5px;
    background: var(--accent); position: relative; }
  .brand-mark::after { content: ""; position: absolute; left: 4px; right: 4px; top: 7px;
    height: 2px; border-radius: 1px; background: var(--accent-fg); }
  .brand-name { font-size: 0.95rem; font-weight: 650; }
  .segmented { display: inline-flex; align-items: center; gap: 2px;
    border: 0.5px solid var(--rule); border-radius: 999px; padding: 2px;
    background: var(--bg-elevated); }
  .segmented button { border: 0; background: none; color: var(--muted);
    font-size: 0.78rem; line-height: 1; padding: 6px 11px; border-radius: 999px;
    cursor: pointer; transition: background .15s, color .15s; }
  .segmented button:hover { color: var(--fg); }
  .segmented button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
  h1 { margin: 0 0 0.2rem; font-size: 1.6rem; letter-spacing: -0.02em; }
  .meta { color: var(--muted); font-size: 0.88rem; margin: 0 0 1.5rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.7rem 0; border-bottom: 1px solid var(--rule);
    display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  li a { color: var(--link); text-decoration: none; font-variant-numeric: tabular-nums; }
  li a:hover { text-decoration: underline; }
  .size { color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .top { display: inline-block; margin-bottom: 2rem; padding: 0.7rem 1rem;
    background: var(--bg-elevated); border: 1px solid var(--rule);
    border-radius: 8px; box-shadow: var(--shadow); color: var(--link); text-decoration: none; }
  .top:hover { border-color: var(--link); }
</style>
</head>
<body>
<main>
  <div class="toolbar">
    <div class="brand"><span class="brand-mark"></span><span class="brand-name">daily-brief</span></div>
    <div class="segmented" role="group" aria-label="Theme">
      <button type="button" data-theme-set="light" aria-pressed="false">☀ Light</button>
      <button type="button" data-theme-set="dark" aria-pressed="false">☾ Dark</button>
      <button type="button" data-theme-set="paper" aria-pressed="false">▤ Paper</button>
    </div>
  </div>
  <h1>Archive</h1>
  <p class="meta">${dates.length} report${dates.length === 1 ? "" : "s"} · newest first · generated ${new Date().toISOString().slice(0, 10)}</p>
  <a class="top" href="./index.html">→ Latest report (${latest})</a>
  <ul>
${rows}
  </ul>
</main>
<script>
(function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll("[data-theme-set]");
  function sync(t) {
    root.setAttribute("data-theme", t);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-theme-set") === t ? "true" : "false");
    }
    try { localStorage.setItem("db-report-theme", t); } catch (e) {}
  }
  sync(root.getAttribute("data-theme") || "light");
  for (var j = 0; j < buttons.length; j++) {
    buttons[j].addEventListener("click", function () { sync(this.getAttribute("data-theme-set")); });
  }
})();
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "archive.html"), archiveHtml, "utf8");
console.log(`[build-site] archive.html (${dates.length} dates)`);

// .nojekyll prevents GitHub Pages from running Jekyll, which would otherwise
// strip directories whose names start with "_". We don't have any today but
// it's cheap insurance and standard practice for static-site GH Pages.
fs.writeFileSync(path.join(ROOT, ".nojekyll"), "", "utf8");
console.log(`[build-site] .nojekyll`);
