import "./_env";

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addSource,
  applySourcePatch,
  readSourceConfig,
  readSourceConfigLenient,
  removeSource,
  sanitizePatch,
  toSourceDef,
  writeSourceConfig,
} from "../lib/sources/config";
import { readCategoriesConfig, writeCategoriesConfig } from "../lib/categories";
import type { ArticleInput, DailyReport } from "../lib/ai/pipeline";
import {
  mergeRefreshedSource,
  readArticles,
  readReport,
  writeArticles,
  writeHtml,
} from "../lib/output/store";
import { JobQueue, QueueBusyError } from "../lib/publish/job-queue";
import type { Job } from "../lib/publish/job-queue";
import { REPORTS_DIR } from "../lib/publish/drafts";
import { WechatMpClient, loadWechatMpConfig } from "../lib/publish/channels/wechat-mp";
import { buildWechatPreview } from "../lib/publish/preview";
import { pushWechatDraft } from "../lib/publish/wechat-push";
import {
  listPieces,
  readPieceDetail,
  runPiece,
} from "../lib/publish/piece-runner";
import type { PieceOutcome, PieceRequest } from "../lib/publish/piece-runner";
import { channelOptionsFromEnv } from "../lib/sources/channel";
import { describeError, fetchWithStatus } from "../lib/sources/run";
import { makeStatus, readStatus, recordStatus } from "../lib/sources/status";
import { todayKey } from "../lib/utils";

/**
 * Source-management API + page. Binds to loopback and is published by nginx
 * under /admin/; every data route requires the bearer token so the public
 * port cannot rewrite sources.config.json.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(__dirname, "admin", "index.html");
// Relative to the process cwd, same as scripts/daily.ts: the report tree is
// part of the deployment, not of the source tree.
const OUTPUT_DIR = REPORTS_DIR;
// A refresh rewrites one shared sidecar; a second concurrent click would race
// the read-modify-write and could drop the first one's additions.
let refreshBusy = false;
const TOKEN_PATH = path.join(os.homedir(), ".daily-brief-admin-token");
const PORT = Number(process.env.ADMIN_PORT ?? 8183);
const HOST = process.env.ADMIN_HOST ?? "127.0.0.1";
const MAX_BODY = 64 * 1024;
// Some feeds hold the socket open without sending data, and neither
// rss-parser's timeout nor curl's -m always fires. The admin UI must answer.
const TEST_TIMEOUT_MS = Number(process.env.ADMIN_TEST_TIMEOUT_MS ?? 25000);

function loadToken(): string {
  const fromEnv = process.env.ADMIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(TOKEN_PATH)) {
    const existing = fs.readFileSync(TOKEN_PATH, "utf8").trim();
    if (existing) return existing;
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}

const TOKEN = loadToken();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function authorized(req: http.IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error(`request body exceeds ${MAX_BODY} bytes`);
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Re-fetch one source and fold it into the day's sidecar, then rebuild the
 * HTML from disk. No LLM call: entries already saved keep the summaries the
 * daily run produced, and only unseen URLs are appended.
 */
async function handleRefresh(
  res: http.ServerResponse,
  id: string,
  dateParam: string | null,
): Promise<void> {
  const source = readSourceConfigLenient().sources.find((s) => s.id === id);
  if (!source) {
    sendJson(res, 404, { error: `unknown source id '${id}'` });
    return;
  }
  const date = dateParam ?? todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendJson(res, 400, { error: `date must be YYYY-MM-DD, got '${date}'` });
    return;
  }

  // Read before taking the busy flag: a missing report is a client error and
  // must not leave the flag set for the next request.
  let report: DailyReport;
  let articles: ArticleInput[];
  try {
    report = readReport(OUTPUT_DIR, date);
    articles = readArticles(OUTPUT_DIR, date);
  } catch (e) {
    sendJson(res, 400, { error: `${describeError(e)} — run \`npm run daily\` for ${date} first` });
    return;
  }

  if (refreshBusy) {
    sendJson(res, 409, { error: "another refresh is already running" });
    return;
  }
  refreshBusy = true;
  try {
    const { items, origin } = await withTimeout(
      fetchWithStatus(source, "test", channelOptionsFromEnv()),
      TEST_TIMEOUT_MS,
      `timeout after ${TEST_TIMEOUT_MS}ms`,
    );
    const { articles: next, added } = mergeRefreshedSource(articles, items, source.name);
    writeArticles(OUTPUT_DIR, date, next);
    writeHtml(OUTPUT_DIR, date, report, next, readSourceConfigLenient().sources);
    sendJson(res, 200, {
      ok: true,
      date,
      itemCount: items.length,
      added,
      total: next.length,
      origin,
    });
  } catch (e) {
    const message = describeError(e);
    // Same as the test action: leave a failure in the status column so a
    // timed-out refresh does not look like it succeeded.
    if (message.startsWith("timeout after")) {
      recordStatus(makeStatus(id, "test", Date.now() - TEST_TIMEOUT_MS, { ok: false, error: message }));
    }
    sendJson(res, 200, { ok: false, error: message });
  } finally {
    refreshBusy = false;
  }
}

/**
 * Writing a piece runs several fetches and one long model call; the reverse
 * proxy cuts a request at 60s, so the page submits a job and polls it instead
 * of holding the connection open.
 */
interface PieceJobResult {
  slug: string;
  words: number;
  markdownPath: string;
  skipped: boolean;
  warnings: string[];
  review: { verdict: string; mechanical: number; facts: number } | null;
}

// One writing job at a time: two would race the shared bodies.json and split
// the model quota.
const pieceJobs = new JobQueue<PieceJobResult>({ concurrency: 1, keep: 20 });

function readDateParam(url: URL): string {
  const raw = url.searchParams.get("date");
  if (raw === null || raw === "") return todayKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`date must be YYYY-MM-DD, got '${raw}'`);
  }
  return raw;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function toJobResult(outcome: PieceOutcome): PieceJobResult {
  if (outcome.skipped) {
    return {
      slug: outcome.slug,
      words: 0,
      markdownPath: outcome.markdownPath,
      skipped: true,
      warnings: [],
      review: null,
    };
  }
  const { result } = outcome;
  return {
    slug: result.slug,
    words: result.meta.words,
    markdownPath: result.markdownPath,
    skipped: false,
    warnings: result.warnings,
    review: result.review
      ? {
          verdict: result.review.verdict,
          mechanical: result.review.mechanical.length,
          facts: result.review.facts.length,
        }
      : null,
  };
}

function submitPiece(body: Record<string, unknown>, date: string): Job<PieceJobResult> {
  const kind = body.kind;
  if (kind !== "topic" && kind !== "digest") {
    throw new Error("kind must be 'topic' or 'digest'");
  }
  const topic = optionalString(body.topic, "topic");
  const categories = optionalStringList(body.categories, "categories");
  // 参数错误在提交时就拒绝，不排进任务队列再失败。
  if (kind === "topic" && !topic?.trim()) throw new Error("topic 不能为空");
  if (kind === "digest" && !categories?.length) throw new Error("categories 不能为空");
  const request: PieceRequest = {
    dir: OUTPUT_DIR,
    date,
    kind,
    topic,
    categories,
    queries: optionalStringList(body.queries, "queries"),
    force: body.force === true,
    review: body.review !== false,
  };
  const label =
    kind === "topic"
      ? `主题稿：${request.topic ?? ""}`
      : `资讯汇总：${(request.categories ?? []).join(",")}`;
  return pieceJobs.start(label, async (handle) =>
    toJobResult(
      await runPiece(request, {
        onStage: (stage) => handle.setStage(stage),
        onLog: (line) => handle.log(line),
      }),
    ),
  );
}

/**
 * 页面入口前缀。nginx 原样转发 `/admin/...` 与 `/editor/...`，路由与 API 都在
 * 剥掉前缀后的路径上匹配；两条入口返回同一份页面，由浏览器用原始 URL 决定视图。
 */
const ENTRY_PREFIXES = ["/admin", "/editor"] as const;

function stripEntryPrefix(pathname: string): string {
  for (const prefix of ENTRY_PREFIXES) {
    if (pathname === prefix) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return pathname;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = stripEntryPrefix(url.pathname);

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    if (!fs.existsSync(PAGE_PATH)) {
      sendJson(res, 500, { error: `page missing: ${PAGE_PATH}` });
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(PAGE_PATH));
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    // Reachability and config validity are separate signals: a monitoring probe
    // still gets 200 while `ok:false` names the broken config. This route is
    // the strict reader, so a reference mismatch shows up here even though
    // /api/sources serves the list with warnings instead.
    const health: { ok: boolean; categories: string[]; sources?: number; error?: string } = {
      ok: true,
      categories: readCategoriesConfig().categories.map((c) => c.id),
    };
    try {
      health.sources = readSourceConfig().length;
    } catch (e) {
      health.ok = false;
      health.error = describeError(e);
    }
    sendJson(res, 200, health);
    return;
  }

  if (!authorized(req)) {
    sendJson(res, 401, { error: "missing or invalid bearer token" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/sources") {
    // Undeclared category/subcategory references come back as warnings so the
    // page still lists the source the operator has to fix.
    const { sources, warnings } = readSourceConfigLenient();
    sendJson(res, 200, {
      sources,
      status: readStatus(),
      // Declared categories/subcategories drive the admin page's filters and
      // its "add source" form; the page never hardcodes the taxonomy. Read per
      // request so edits made through /api/categories show up immediately.
      categories: readCategoriesConfig().categories.map((c) => ({
        id: c.id,
        label: c.labelZh,
        subcategories: c.subcategories.map((sub) => ({ id: sub.id, label: sub.labelZh })),
      })),
      warnings,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/categories") {
    sendJson(res, 200, {
      path: "categories.config.json",
      config: readCategoriesConfig(),
    });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/categories") {
    try {
      const saved = writeCategoriesConfig(await readBody(req));
      // Source validation reads the taxonomy from disk on every call, so the
      // saved config governs the next request without a restart.
      sendJson(res, 200, { config: saved });
    } catch (e) {
      // A rejected write leaves the file untouched and the panel closes
      // without a trace, so the reason also goes to the service log.
      console.error(`[admin] categories.config.json rejected: ${describeError(e)}`);
      sendJson(res, 400, { error: describeError(e) });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/sources") {
    const created = toSourceDef(await readBody(req));
    const { sources: current } = readSourceConfigLenient();
    // Collect warnings from the write itself: validating the full list is what
    // the next request will see, so reading warnings are already stale.
    const warnings: string[] = [];
    const next = writeSourceConfig(addSource(current, created), { warnings });
    sendJson(res, 201, { source: next.find((s) => s.id === created.id), sources: next, warnings });
    return;
  }

  if (req.method === "GET" && pathname === "/api/articles") {
    const date = readDateParam(url);
    sendJson(res, 200, { date, articles: readArticles(OUTPUT_DIR, date) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/pieces") {
    const date = readDateParam(url);
    sendJson(res, 200, {
      date,
      pieces: listPieces(OUTPUT_DIR, date),
      jobs: pieceJobs.list(),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/pieces") {
    const date = readDateParam(url);
    try {
      const job = submitPiece(await readBody(req), date);
      sendJson(res, 202, { job });
    } catch (e) {
      if (e instanceof QueueBusyError) {
        sendJson(res, 409, { error: e.message });
        return;
      }
      throw e;
    }
    return;
  }

  const jobMatch = /^\/api\/pieces\/job\/([A-Za-z0-9-]+)$/.exec(pathname);
  if (req.method === "GET" && jobMatch) {
    const job = pieceJobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: `unknown job '${jobMatch[1]}'` });
      return;
    }
    sendJson(res, 200, { job });
    return;
  }

  const previewMatch = /^\/api\/pieces\/([^/]+)\/preview$/.exec(pathname);
  if (req.method === "GET" && previewMatch) {
    const date = readDateParam(url);
    const slug = decodeURIComponent(previewMatch[1]);
    const theme = url.searchParams.get("theme") ?? undefined;
    try {
      const preview = buildWechatPreview({ dir: OUTPUT_DIR, date, slug, theme });
      sendJson(res, 200, { date, slug, ...preview });
    } catch (error) {
      sendJson(res, 400, { error: describeError(error) });
    }
    return;
  }

  const pushMatch = /^\/api\/pieces\/([^/]+)\/push$/.exec(pathname);
  if (req.method === "POST" && pushMatch) {
    const date = readDateParam(url);
    const slug = decodeURIComponent(pushMatch[1]);
    const theme = url.searchParams.get("theme") ?? undefined;
    const force = url.searchParams.get("force") === "1";
    try {
      const config = loadWechatMpConfig();
      const result = await pushWechatDraft(
        { dir: OUTPUT_DIR, date, slug, theme, force },
        new WechatMpClient(config),
        config.cover,
      );
      sendJson(res, 200, { date, slug, ...result });
    } catch (error) {
      sendJson(res, 400, { error: describeError(error) });
    }
    return;
  }

  const pieceMatch = /^\/api\/pieces\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && pieceMatch) {
    const date = readDateParam(url);
    const slug = decodeURIComponent(pieceMatch[1]);
    const detail = readPieceDetail(OUTPUT_DIR, date, slug);
    if (!detail) {
      sendJson(res, 404, { error: `no piece '${slug}' for ${date}` });
      return;
    }
    sendJson(res, 200, { date, ...detail });
    return;
  }

  const testMatch = /^\/api\/sources\/([^/]+)\/test$/.exec(pathname);
  if (req.method === "POST" && testMatch) {
    const id = decodeURIComponent(testMatch[1]);
    const source = readSourceConfigLenient().sources.find((s) => s.id === id);
    if (!source) {
      sendJson(res, 404, { error: `unknown source id '${id}'` });
      return;
    }
    try {
      const { items, origin } = await withTimeout(
        fetchWithStatus(source, "test", channelOptionsFromEnv()),
        TEST_TIMEOUT_MS,
        `timeout after ${TEST_TIMEOUT_MS}ms`,
      );
      sendJson(res, 200, {
        ok: true,
        itemCount: items.length,
        origin,
        samples: items.slice(0, 3).map((it) => ({ title: it.title, url: it.url })),
      });
    } catch (e) {
      const message = describeError(e);
      // Record the timeout so the list shows a failure instead of stale data;
      // the underlying fetch overwrites this entry if it ever finishes.
      if (message.startsWith("timeout after")) {
        recordStatus(makeStatus(id, "test", Date.now() - TEST_TIMEOUT_MS, { ok: false, error: message }));
      }
      sendJson(res, 200, { ok: false, error: message });
    }
    return;
  }

  const refreshMatch = /^\/api\/sources\/([^/]+)\/refresh$/.exec(pathname);
  if (req.method === "POST" && refreshMatch) {
    await handleRefresh(res, decodeURIComponent(refreshMatch[1]), url.searchParams.get("date"));
    return;
  }

  const idMatch = /^\/api\/sources\/([^/]+)$/.exec(pathname);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]);
    if (req.method === "PATCH") {
      const patch = sanitizePatch(await readBody(req));
      const { sources: current } = readSourceConfigLenient();
      const warnings: string[] = [];
      const next = writeSourceConfig(applySourcePatch(current, id, patch), { warnings });
      sendJson(res, 200, { source: next.find((s) => s.id === id), sources: next, warnings });
      return;
    }
    if (req.method === "DELETE") {
      const { sources: current } = readSourceConfigLenient();
      const warnings: string[] = [];
      const next = writeSourceConfig(removeSource(current, id), { warnings });
      sendJson(res, 200, { removed: id, count: next.length, warnings });
      return;
    }
  }

  sendJson(res, 404, { error: `no route for ${req.method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e: unknown) => {
    sendJson(res, 400, { error: describeError(e) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[admin] listening on http://${HOST}:${PORT}`);
  console.log(`[admin] token file: ${TOKEN_PATH}`);
  // Starting up must not depend on a perfect config: the page exists to fix
  // one, so reference problems are printed and the process keeps serving.
  const { sources, warnings } = readSourceConfigLenient();
  console.log(`[admin] sources: ${sources.length}`);
  for (const warning of warnings) console.warn(`[admin] config warning: ${warning}`);
});
