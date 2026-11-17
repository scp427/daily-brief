import fs from "node:fs";
import path from "node:path";

import type { ArticleInput, DailyReport } from "../ai/pipeline";
import type { RawArticle, SourceDef } from "../sources/types";
import { groupRaw, renderHtml, renderOverflowFiles } from "./render";

/**
 * The daily report lives as two files that two writers now share: the daily
 * pipeline (fresh data + LLM) and the admin refresh action (one source
 * re-fetched). Both read and write them through here so a field added to
 * ArticleInput cannot drift between the two paths.
 */

function dateDir(dir: string, date: string): string {
  return path.join(dir, date);
}

export function reportPath(dir: string, date: string): string {
  return path.join(dateDir(dir, date), `${date}.json`);
}

export function articlesPath(dir: string, date: string): string {
  return path.join(dateDir(dir, date), `${date}-articles.json`);
}

export function readReport(dir: string, date: string): DailyReport {
  const file = reportPath(dir, date);
  if (!fs.existsSync(file)) {
    throw new Error(`Report JSON not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as DailyReport;
}

export function readArticles(dir: string, date: string): ArticleInput[] {
  const file = articlesPath(dir, date);
  if (!fs.existsSync(file)) {
    throw new Error(`Articles sidecar not found: ${file}`);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    articles: Array<Omit<ArticleInput, "publishedAt"> & { publishedAt?: string }>;
  };
  return data.articles.map((a) => ({
    ...a,
    publishedAt: a.publishedAt ? new Date(a.publishedAt) : undefined,
  }));
}

export function writeArticles(dir: string, date: string, articles: ArticleInput[]): void {
  const file = articlesPath(dir, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ date, articles }, null, 2), "utf8");
}

export function writeReport(dir: string, date: string, report: DailyReport): void {
  const file = reportPath(dir, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
}

/**
 * Fold a fresh fetch of one source into the day's article list.
 *
 * Entries already on disk win on a URL collision: they carry the LLM summary
 * produced by the daily run, which a raw fetch cannot reproduce. Only unseen
 * URLs are appended, so repeating the action is idempotent instead of
 * duplicating the source's whole feed every click.
 */
export function mergeRefreshedSource(
  existing: ArticleInput[],
  incoming: RawArticle[],
  sourceName: string,
): { articles: ArticleInput[]; added: number } {
  const seen = new Set(existing.map((a) => a.url));
  const added = incoming
    .filter((it) => !seen.has(it.url))
    .map((it) => ({ ...it, source: sourceName }));
  return { articles: [...existing, ...added], added: added.length };
}

/** Rebuild `<date>.html` and its overflow fragments from files on disk — no fetch, no LLM call. */
export function writeHtml(
  dir: string,
  date: string,
  report: DailyReport,
  articles: ArticleInput[],
  sources: SourceDef[],
): string {
  const raw = groupRaw(articles, sources);
  const file = path.join(dateDir(dir, date), `${date}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderHtml(report, raw, date), "utf8");
  for (const fragment of renderOverflowFiles(raw, date)) {
    const target = path.join(dateDir(dir, date), fragment.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fragment.html, "utf8");
  }
  return file;
}
