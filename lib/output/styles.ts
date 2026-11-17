/**
 * Self-contained stylesheet for the generated report.
 *
 * Kept in a separate module so render.ts stays readable, but injected inline
 * into the HTML by renderHtml() — the published report remains a single
 * offline-capable file with no external assets.
 *
 * Themes: light (default), dark, paper. Theme choice lives on
 * <html data-theme="..."> and is applied by THEME_BOOTSTRAP_SCRIPT before
 * first paint. Density is <html data-density="compact|comfortable">.
 */

/** Applied in <head> before <style> to avoid a flash of the wrong theme. */
export const THEME_BOOTSTRAP_SCRIPT = `<script>
(function () {
  var t = "light";
  try { t = localStorage.getItem("db-report-theme") || ""; } catch (e) {}
  if (t !== "light" && t !== "dark" && t !== "paper") {
    t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var d = "";
  try { d = localStorage.getItem("db-report-density") || ""; } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.setAttribute("data-density", d === "compact" ? "compact" : "comfortable");
})();
</script>`;

export const REPORT_CSS = String.raw`
:root, html[data-theme="light"] {
  color-scheme: light;
  --bg: #f6f7fa;
  --bg-elevated: #ffffff;
  --bg-subtle: #eef1f6;
  --fg: #14181f;
  --fg-soft: #3c4451;
  --muted: #6b7482;
  --rule: #e1e6ed;
  --rule-strong: #cbd3de;
  --card: #f3f6fa;
  --link: #3454d1;
  --accent: #3454d1;
  --accent-fg: #ffffff;
  --accent-soft: rgba(52, 84, 209, 0.09);
  --up: #d13a34;
  --down: #12885c;
  --warn: #b06b12;
  --info: #3454d1;
  --shadow: 0 1px 2px rgba(20, 24, 31, 0.04), 0 4px 14px rgba(20, 24, 31, 0.03);
  --shadow-hover: 0 2px 5px rgba(20, 24, 31, 0.06), 0 10px 24px rgba(20, 24, 31, 0.06);
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --font-head: var(--font-body);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --radius-sm: 6px;
  --radius: 10px;
  --radius-lg: 14px;
  --space-article: 1rem;
  --space-list: 0.7rem;
  --space-section: 1.6rem;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d1117;
  --bg-elevated: #161b23;
  --bg-subtle: #1c222c;
  --fg: #e9eef6;
  --fg-soft: #c1c9d6;
  --muted: #8d97a7;
  --rule: #29313c;
  --rule-strong: #3c4756;
  --card: #1a2029;
  --link: #8aabff;
  --accent: #7196ff;
  --accent-fg: #0d1117;
  --accent-soft: rgba(113, 150, 255, 0.15);
  --up: #ff7b73;
  --down: #4ad6a0;
  --warn: #e6ae61;
  --info: #8aabff;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-hover: 0 8px 24px rgba(0, 0, 0, 0.35);
}

html[data-theme="paper"] {
  color-scheme: light;
  --bg: #f2ecdf;
  --bg-elevated: #fffcf4;
  --bg-subtle: #eae1cf;
  --fg: #2c271f;
  --fg-soft: #4c4437;
  --muted: #817663;
  --rule: #ddd2bb;
  --rule-strong: #bfb193;
  --card: #f7f0e2;
  --link: #8a4b20;
  --accent: #8a4b20;
  --accent-fg: #fffcf4;
  --accent-soft: rgba(138, 75, 32, 0.10);
  --up: #b23a2e;
  --down: #3f7352;
  --warn: #96631b;
  --info: #8a4b20;
  --shadow: none;
  --shadow-hover: 0 2px 0 rgba(138, 75, 32, 0.12);
  --font-body: "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, "Times New Roman", serif;
  --font-head: var(--font-body);
  --radius-sm: 3px;
  --radius: 5px;
  --radius-lg: 7px;
}

html[data-density="compact"] {
  --space-article: 0.7rem;
  --space-list: 0.5rem;
  --space-section: 1.2rem;
}

/* English locale follows the Western green-up / red-down convention. */
html[lang="en"] { --up: #12885c; --down: #d13a34; }
html[lang="en"][data-theme="dark"] { --up: #4ad6a0; --down: #ff7b73; }
html[lang="en"][data-theme="paper"] { --up: #3f7352; --down: #b23a2e; }

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: var(--link); }
button { font-family: inherit; }
main {
  max-width: 1040px;
  margin: 0 auto;
  padding: 2.2rem 1.6rem 4rem;
}

/* ===== top utility bar ===== */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 1.4rem;
}
.brand-row { display: flex; align-items: center; gap: 9px; }
.brand-mark {
  display: inline-block;
  width: 17px; height: 17px;
  border-radius: 5px;
  background: var(--accent);
  position: relative;
}
.brand-mark::after {
  content: "";
  position: absolute;
  left: 4px; right: 4px; top: 7px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent-fg);
}
.brand-name { font-size: 0.95rem; font-weight: 650; letter-spacing: 0.01em; }
.brand-sub {
  font-size: 0.68rem; letter-spacing: 0.18em;
  color: var(--muted); text-transform: uppercase;
}
.toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.segmented {
  display: inline-flex;
  border: 0.5px solid var(--rule);
  border-radius: 999px;
  padding: 2px;
  background: var(--bg-elevated);
  gap: 2px;
}
.segmented button {
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1;
  padding: 6px 11px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.segmented button:hover { color: var(--fg); }
.segmented button[aria-pressed="true"] {
  background: var(--accent);
  color: var(--accent-fg);
}
.toolbar-link {
  font-size: 0.8rem;
  color: var(--muted);
  text-decoration: none;
  border: 0.5px solid var(--rule);
  border-radius: 999px;
  padding: 6px 12px;
  background: var(--bg-elevated);
}
.toolbar-link:hover { color: var(--link); border-color: var(--link); }

/* ===== report header ===== */
header.report-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 1.6rem;
}
.eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 500;
}
.report-title {
  font-family: var(--font-head);
  font-size: 2.5rem;
  font-weight: 650;
  margin: 0.25rem 0 0;
  letter-spacing: -0.035em;
  line-height: 1.08;
  font-variant-numeric: tabular-nums;
}
.date-weekday {
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--muted);
  letter-spacing: 0;
  margin-left: 0.65rem;
  vertical-align: 0.25em;
}
.stat-strip { display: flex; gap: 8px; flex-wrap: wrap; }
.stat {
  min-width: 82px;
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: var(--radius);
  padding: 9px 14px;
  text-align: center;
}
.stat-label { display: block; font-size: 0.72rem; color: var(--muted); line-height: 1.4; }
.stat-value {
  display: block;
  font-size: 1.4rem;
  font-weight: 650;
  line-height: 1.2;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-head);
}
.archive-link {
  display: inline-block;
  font-size: 0.8rem;
  color: var(--muted);
  text-decoration: none;
  border-bottom: 1px dashed var(--rule-strong);
  padding-bottom: 1px;
}
.archive-link:hover { color: var(--link); border-bottom-style: solid; }

/* ===== AI overview ===== */
.hero-card {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-lg);
  padding: 1.15rem 1.35rem;
  box-shadow: var(--shadow);
}
.hero-eyebrow {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 600;
}
.hero-headline {
  font-family: var(--font-head);
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0.4rem 0 0;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: var(--fg);
}
.overview-card {
  margin: 0.7rem 0 0;
  padding: 0.65rem 0.9rem;
  background: var(--card);
  border-radius: var(--radius-sm);
  border-left: 2px solid var(--rule-strong);
}
.overview-card .eyebrow { display: block; margin-bottom: 0.2rem; }
.overview-text {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.75;
  color: var(--fg-soft);
}
.keywords { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.85rem 0 0; }
.keyword {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 0.15rem 0.65rem;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 500;
}
.editor-card {
  background: var(--card);
  border-left: 3px solid var(--warn);
  border-radius: var(--radius-sm);
  padding: 0.8rem 1.1rem;
  margin-top: 0.8rem;
}
.editor-card .eyebrow { display: block; margin-bottom: 0.25rem; color: var(--warn); }
.editor-text { margin: 0; font-size: 0.88rem; line-height: 1.7; color: var(--fg-soft); }

/* ===== digest cards ===== */
.digest-category { margin-top: var(--space-section); }
.category-header {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  margin: 0 0 0.7rem;
  padding-bottom: 0.4rem;
  border-bottom: 0.5px solid var(--rule);
}
.category-title {
  font-family: var(--font-head);
  font-size: 1rem;
  font-weight: 600;
  color: var(--fg);
  margin: 0;
  letter-spacing: 0.02em;
}
.category-count {
  font-size: 0.7rem;
  color: var(--muted);
  background: var(--bg-subtle);
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
}
.brief-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-list);
}
@media (min-width: 700px) { .brief-list { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); } }
.brief {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: var(--radius);
  padding: 0.8rem 1rem;
  transition: border-color 0.15s, transform 0.15s;
}
.brief:hover { border-color: var(--rule-strong); transform: translateY(-1px); }
.brief-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem; margin-bottom: 0.35rem;
}
.brief-source {
  font-size: 0.7rem; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;
}
.brief-rank {
  font-size: 0.68rem; font-weight: 600;
  padding: 0.1rem 0.45rem; border-radius: 999px;
  background: var(--bg-subtle); color: var(--muted);
  flex-shrink: 0;
}
.brief-rank.high { background: color-mix(in srgb, var(--up) 14%, transparent); color: var(--up); }
.brief-rank.mid { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
.brief-title { font-size: 0.95rem; font-weight: 600; margin: 0 0 0.3rem; line-height: 1.45; }
.brief-title a { color: var(--fg); text-decoration: none; }
.brief-title a:hover { color: var(--link); text-decoration: underline; }
.brief-summary { margin: 0; color: var(--fg-soft); font-size: 0.85rem; line-height: 1.6; }

/* ===== primary tabs (sticky) ===== */
.tabs {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 2px;
  margin: 1.6rem 0 0;
  padding-top: 6px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-bottom: 0.5px solid var(--rule);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  background: none;
  border: 0;
  padding: 0.7rem 1rem 0.75rem;
  font-size: 0.94rem;
  font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -0.5px;
  white-space: nowrap;
  transition: color 0.15s;
}
.tab::before {
  content: "";
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--panel-accent, var(--muted));
  margin-right: 7px;
  vertical-align: 0.12em;
  opacity: 0.55;
}
.tab:hover { color: var(--fg); }
.tab.active { color: var(--fg); border-bottom-color: var(--panel-accent, var(--accent)); }
.tab.active::before { opacity: 1; }
.tab .count {
  font-size: 0.72rem;
  color: var(--muted);
  margin-left: 0.4rem;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.panel { display: none; padding-top: 1.5rem; }
.panel.active { display: block; }
.panel > .hero-card:first-child { margin-top: 0; }

/* ===== L2 / L3 tabs ===== */
.sub-tabs, .trading-group-tabs {
  display: flex; flex-wrap: wrap; gap: 7px;
  margin: 0 0 1rem;
}
.sub-content { display: none; }
.sub-content.active { display: block; }
.sub-tab, .trading-group-tab {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  padding: 0.42rem 0.95rem;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--fg-soft);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.sub-tab:hover, .trading-group-tab:hover { border-color: var(--rule-strong); color: var(--fg); }
.sub-tab.active, .trading-group-tab.active {
  background: var(--panel-accent, var(--accent));
  color: #fff;
  border-color: transparent;
}
html[data-theme="light"] .sub-tab.active,
html[data-theme="paper"] .sub-tab.active,
html[data-theme="light"] .trading-group-tab.active,
html[data-theme="paper"] .trading-group-tab.active { color: var(--bg-elevated); }
.sub-tab .count, .trading-group-tab .count {
  font-size: 0.7rem; opacity: 0.75; margin-left: 0.35rem;
  font-variant-numeric: tabular-nums;
}
.source-tabs {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin: 0 0 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 0.5px solid var(--rule);
}
.source-tab {
  background: none;
  border: 0.5px solid var(--rule);
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  font-size: 0.8rem;
  color: var(--muted);
  cursor: pointer;
}
.source-tab:hover { border-color: var(--rule-strong); color: var(--fg); }
.source-tab.active { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.source-tab .count { font-size: 0.7rem; opacity: 0.75; margin-left: 0.3rem; }
.source-content { display: none; }
.source-content.active { display: block; }

/* ===== article cards ===== */
.source-content, .sub-content { counter-reset: article; }
.article {
  counter-increment: article;
  position: relative;
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: var(--radius);
  padding: var(--space-article) 1.05rem var(--space-article) 2.9rem;
  margin-bottom: var(--space-list);
  box-shadow: var(--shadow);
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}
.article::before {
  content: counter(article, decimal-leading-zero);
  position: absolute;
  left: 1.05rem; top: calc(var(--space-article) + 0.15rem);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.article::after {
  content: "";
  position: absolute;
  left: 0; top: 0.9rem; bottom: 0.9rem;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--panel-accent, var(--accent));
  opacity: 0.32;
}
.article:hover {
  border-color: var(--rule-strong);
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.article:hover::after { opacity: 1; }
.article-title {
  font-family: var(--font-head);
  font-size: 1.02rem;
  font-weight: 600;
  margin: 0 0 0.35rem;
  line-height: 1.5;
}
.article-title a { color: var(--fg); text-decoration: none; }
.article-title a:hover { color: var(--link); }
.article-tags {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 6px; margin: 0 0 0.4rem;
}
.tag {
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 999px;
  padding: 0.08rem 0.5rem;
  font-size: 0.72rem;
  line-height: 1.6;
  font-weight: 500;
}
.tag-src {
  background: none;
  border: 0.5px solid var(--rule);
  color: var(--muted);
  font-weight: 400;
}
.article-time { color: var(--muted); font-size: 0.76rem; font-variant-numeric: tabular-nums; }
.article-stats {
  color: var(--muted); font-size: 0.78rem; margin: 0 0 0.4rem;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
}
.article-excerpt {
  margin: 0; color: var(--fg-soft);
  font-size: 0.88rem; line-height: 1.65;
  overflow-wrap: anywhere;
}
.article-summary {
  margin: 0.6rem 0 0;
  padding: 0.55rem 0.85rem;
  background: var(--card);
  border-left: 2px solid var(--accent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 0.88rem; line-height: 1.65;
  color: var(--fg);
}
.summary-label {
  display: inline-block;
  font-size: 0.68rem;
  color: var(--accent);
  background: var(--accent-soft);
  margin-right: 0.45rem;
  padding: 0.05rem 0.4rem;
  border-radius: 4px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.empty { color: var(--muted); text-align: center; padding: 2.5rem 0; font-size: 0.9rem; }

/* ===== progressive loading ===== */
.more-slot {
  display: block;
  width: 100%;
  margin: 1rem 0 0.5rem;
  padding: 0.8rem;
  border: 0.5px dashed var(--rule-strong);
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  text-align: center;
  cursor: pointer;
}
.more-slot:hover { border-color: var(--accent); color: var(--link); background: var(--accent-soft); }
.more-page[hidden] { display: none; }

/* ===== trading panel ===== */
.trading-overview-card {
  margin: 0 0 1.4rem;
  padding: 1rem 1.25rem;
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-left: 3px solid var(--panel-accent, var(--accent));
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.trading-overview-card .eyebrow { display: block; margin-bottom: 0.4rem; color: var(--panel-accent, var(--accent)); }
.trading-overview-text { font-size: 0.9rem; line-height: 1.78; color: var(--fg-soft); margin: 0; }

.trading-section-title {
  font-family: var(--font-head);
  font-size: 1rem; font-weight: 600;
  margin: var(--space-section) 0 0.85rem;
  padding-bottom: 0.4rem;
  border-bottom: 0.5px solid var(--rule);
  color: var(--fg); letter-spacing: 0.02em;
}
.trading-picks { display: grid; grid-template-columns: 1fr; gap: var(--space-list); }
@media (min-width: 700px) { .trading-picks { grid-template-columns: 1fr 1fr; } }
.trading-pick {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-left: 3px solid var(--muted);
  border-radius: var(--radius);
  padding: 0.8rem 1rem;
}
.trading-pick.stance-bull { border-left-color: var(--up); }
.trading-pick.stance-bear { border-left-color: var(--down); }
.pick-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.4rem; }
.pick-symbol-block { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.pick-symbol { font-weight: 650; font-size: 1rem; font-family: var(--font-mono); }
.pick-name { color: var(--muted); font-size: 0.8rem; }
.pick-stance {
  font-size: 0.74rem; font-weight: 600;
  padding: 0.15rem 0.55rem; border-radius: 999px; white-space: nowrap;
}
.pick-stance-bull { background: color-mix(in srgb, var(--up) 13%, transparent); color: var(--up); }
.pick-stance-bear { background: color-mix(in srgb, var(--down) 13%, transparent); color: var(--down); }
.pick-stance-neutral { background: var(--bg-subtle); color: var(--muted); }
.pick-rationale { margin: 0; font-size: 0.86rem; line-height: 1.7; color: var(--fg-soft); }

.crypto-widgets { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-list); margin: 0 0 1.3rem; }
@media (min-width: 700px) { .crypto-widgets { grid-template-columns: repeat(4, 1fr); } }
.crypto-widget {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: var(--radius);
  padding: 0.7rem 0.85rem;
  text-align: center;
}
.widget-label {
  font-size: 0.68rem; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.25rem;
}
.widget-value {
  font-size: 1.45rem; font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--fg); line-height: 1.15;
  font-family: var(--font-head);
}
.widget-sub { font-size: 0.76rem; color: var(--muted); margin-top: 0.2rem; font-variant-numeric: tabular-nums; }
.widget-sub.positive, .positive { color: var(--down); }
.widget-sub.negative, .negative { color: var(--up); }
.crypto-widget.fg-fear-extreme { border-left: 3px solid var(--up); }
.crypto-widget.fg-fear-extreme .widget-value { color: var(--up); }
.crypto-widget.fg-fear { border-left: 3px solid var(--warn); }
.crypto-widget.fg-fear .widget-value { color: var(--warn); }
.crypto-widget.fg-neutral { border-left: 3px solid var(--muted); }
.crypto-widget.fg-greed { border-left: 3px solid var(--down); }
.crypto-widget.fg-greed .widget-value { color: var(--down); }
.crypto-widget.fg-greed-extreme { border-left: 3px solid var(--down); }
.crypto-widget.fg-greed-extreme .widget-value { color: var(--down); }

.fear-gauge { display: block; width: 88px; height: 50px; margin: 0 auto 0.15rem; }
.fear-gauge .gauge-track { fill: none; stroke: var(--bg-subtle); stroke-width: 9; stroke-linecap: round; }
.fear-gauge .gauge-fill { fill: none; stroke-width: 9; stroke-linecap: round; }

.ticker-card {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: var(--radius);
  padding: 0.9rem 1.1rem;
  margin-bottom: var(--space-list);
  box-shadow: var(--shadow);
}
.ticker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
.ticker-id { min-width: 0; }
.ticker-symbol { margin: 0; font-size: 1rem; font-weight: 650; font-family: var(--font-mono); }
.ticker-name { margin: 0.1rem 0 0; font-size: 0.8rem; color: var(--muted); }
.ticker-price-block { text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 0.3rem; }
.ticker-price { display: block; font-size: 1.1rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.pct-pill {
  display: inline-block;
  font-size: 0.78rem; font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.pct-pill.positive { background: color-mix(in srgb, var(--down) 13%, transparent); color: var(--down); }
.pct-pill.negative { background: color-mix(in srgb, var(--up) 13%, transparent); color: var(--up); }
.sparkline { display: block; width: 62px; height: 22px; }
.ticker-indicators {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 0.35rem 0.9rem; margin: 0;
  font-size: 0.8rem; color: var(--fg-soft);
}
@media (min-width: 700px) { .ticker-indicators { grid-template-columns: repeat(3, 1fr); } }
.ticker-indicators > div { display: flex; gap: 0.4rem; align-items: baseline; min-width: 0; }
.ticker-indicators dt { color: var(--muted); font-size: 0.72rem; margin: 0; white-space: nowrap; }
.ticker-indicators dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 500; color: var(--fg); }
.trend-bullish { color: var(--down); }
.trend-bearish { color: var(--up); }
.trend-neutral { color: var(--muted); }
.rsi-overbought { color: var(--warn); }
.rsi-oversold { color: var(--link); }
.ticker-signals {
  margin-top: 0.7rem; padding-top: 0.6rem;
  border-top: 0.5px dashed var(--rule);
  display: flex; flex-wrap: wrap; gap: 6px;
}
.signal-pill {
  font-size: 0.72rem; padding: 0.15rem 0.5rem;
  border-radius: 999px; font-weight: 500;
}
.signal-pill.tone-bull { background: color-mix(in srgb, var(--down) 13%, transparent); color: var(--down); }
.signal-pill.tone-bear { background: color-mix(in srgb, var(--up) 13%, transparent); color: var(--up); }
.signal-pill.tone-caution { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
.signal-age { opacity: 0.7; font-weight: 400; }

.trading-risk {
  margin: var(--space-section) 0 0;
  padding: 0.85rem 1.15rem;
  background: var(--card);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--warn);
}
.trading-risk .eyebrow { display: block; margin-bottom: 0.3rem; color: var(--warn); }
.trading-risk p { margin: 0; font-size: 0.8rem; line-height: 1.7; color: var(--fg-soft); }

/* ===== footer ===== */
footer {
  margin-top: 3rem;
  border-top: 0.5px solid var(--rule);
  padding-top: 1.1rem;
  color: var(--muted);
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.back-to-top {
  background: var(--bg-elevated);
  border: 0.5px solid var(--rule);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.78rem;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
}
.back-to-top:hover { color: var(--link); border-color: var(--link); }

@media (max-width: 700px) {
  main { padding: 1.3rem 1rem 3rem; }
  .report-title { font-size: 2.05rem; }
  .stat { min-width: 72px; padding: 7px 10px; }
  .stat-value { font-size: 1.2rem; }
  .toolbar { gap: 10px; }
  .article { padding-left: 2.5rem; padding-right: 0.85rem; }
  .article::before { left: 0.85rem; }
  .ticker-head { gap: 0.6rem; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
@media print {
  .toolbar, .tabs, .more-slot, .back-to-top { display: none !important; }
  .panel { display: block !important; page-break-before: always; }
  body { background: #fff; color: #000; }
  .article, .ticker-card, .brief { box-shadow: none; break-inside: avoid; }
}
`;
