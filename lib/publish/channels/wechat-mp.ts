/**
 * 微信公众号草稿箱客户端。
 *
 * 只做四件外部调用：取 access_token、上传正文图、上传封面、写草稿。草稿写完
 * 不自动群发；群发权限按账号类型不同，`probePublish()` 用来在发布前问一次。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "https://api.weixin.qq.com";

/** access_token 有效期 7200 秒，提前 5 分钟换新的，避开临界时刻。 */
const TOKEN_SLACK_MS = 5 * 60 * 1000;

/** 这些 errcode 说明 token 不可用，换一个再重试一次。 */
const AUTH_ERRCODES = new Set([40001, 40014, 42001]);

export interface WechatMpConfig {
  app_id: string;
  app_secret: string;
  /** 封面图本地路径；公众号草稿必须带封面。 */
  cover: string;
  author?: string;
}

export function loadWechatMpConfig(
  file = path.join(os.homedir(), ".daily-brief-wechat.json"),
): WechatMpConfig {
  if (!fs.existsSync(file)) {
    throw new Error(
      `缺少公众号凭据文件 ${file}。写入 {"app_id": "...", "app_secret": "...", "cover": "/path/cover.png"} 后再推送。`,
    );
  }
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${file} 不是对象`);
  }
  const record: Record<string, unknown> = { ...raw };
  for (const key of ["app_id", "app_secret", "cover"]) {
    const value = record[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`${file} 缺少 ${key}`);
    }
  }
  const author = record.author;
  if (author !== undefined && typeof author !== "string") {
    throw new Error(`${file} 的 author 必须是字符串`);
  }
  const cover = record.cover as string;
  if (!fs.existsSync(cover)) {
    throw new Error(`封面图不存在：${cover}`);
  }
  return {
    app_id: record.app_id as string,
    app_secret: record.app_secret as string,
    cover,
    ...(author === undefined ? {} : { author }),
  };
}

export class WechatApiError extends Error {
  readonly errcode: number;
  constructor(errcode: number, errmsg: string, what: string) {
    super(`${what}失败：${errmsg}（errcode ${errcode}）`);
    this.errcode = errcode;
  }
}

export interface WechatDraftArticle {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  thumb_media_id: string;
}

export interface WechatMpDeps {
  fetchImpl?: typeof fetch;
  /** token 缓存文件。 */
  tokenFile?: string;
  now?: () => number;
}

interface TokenCache {
  app_id: string;
  access_token: string;
  expires_at: number;
}

export class WechatMpClient {
  private readonly config: WechatMpConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenFile: string;
  private readonly now: () => number;

  constructor(config: WechatMpConfig, deps: WechatMpDeps = {}) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.tokenFile =
      deps.tokenFile ?? path.join(os.homedir(), ".daily-brief-wechat-token.json");
    this.now = deps.now ?? (() => Date.now());
  }

  private readCache(): TokenCache | null {
    if (!fs.existsSync(this.tokenFile)) return null;
    try {
      const cache: TokenCache = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      if (cache.app_id !== this.config.app_id) return null;
      if (cache.expires_at - TOKEN_SLACK_MS <= this.now()) return null;
      return cache;
    } catch (error) {
      // 缓存文件损坏只值得重新取一次 token，不影响调用方。
      void error;
      return null;
    }
  }

  private writeCache(token: string, expiresIn: number): void {
    const cache: TokenCache = {
      app_id: this.config.app_id,
      access_token: token,
      expires_at: this.now() + expiresIn * 1000,
    };
    fs.writeFileSync(this.tokenFile, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  /** 微信把业务错误也放在 200 响应里，所以这里在 wire 边界读一次 errcode。 */
  private async request(
    what: string,
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, init);
    if (!response.ok) {
      throw new Error(`${what}失败：HTTP ${response.status}`);
    }
    const raw: unknown = await response.json();
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`${what}失败：响应不是 JSON 对象`);
    }
    const body: Record<string, unknown> = { ...raw };
    const errcode = typeof body.errcode === "number" ? body.errcode : 0;
    if (errcode !== 0) {
      const errmsg = typeof body.errmsg === "string" ? body.errmsg : "未知错误";
      throw new WechatApiError(errcode, errmsg, what);
    }
    return body;
  }

  async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.readCache();
      if (cached) return cached.access_token;
    }
    const body = await this.request("获取 access_token", `${API}/cgi-bin/stable_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: this.config.app_id,
        secret: this.config.app_secret,
        force_refresh: forceRefresh,
      }),
    });
    const token = body.access_token;
    if (typeof token !== "string" || token === "") {
      throw new Error("获取 access_token 失败：响应里没有 access_token");
    }
    const expiresIn = body.expires_in;
    this.writeCache(token, typeof expiresIn === "number" ? expiresIn : 7200);
    return token;
  }

  /** 调用带 token 的接口；token 失效时换一个重试一次。 */
  private async withToken(
    what: string,
    build: (token: string) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const token = await this.token();
    try {
      return await build(token);
    } catch (error) {
      if (
        error instanceof WechatApiError &&
        AUTH_ERRCODES.has(error.errcode)
      ) {
        const fresh = await this.token(true);
        return await build(fresh);
      }
      throw error;
    }
  }

  private async upload(
    what: string,
    endpoint: string,
    file: string,
  ): Promise<Record<string, unknown>> {
    if (!fs.existsSync(file)) throw new Error(`${what}失败：文件不存在 ${file}`);
    const fileName = path.basename(file);
    const bytes = fs.readFileSync(file);
    return await this.withToken(what, async (token) => {
      const form = new FormData();
      form.append("media", new Blob([bytes]), fileName);
      return await this.request(what, `${API}${endpoint}&access_token=${token}`, {
        method: "POST",
        body: form,
      });
    });
  }

  /** 正文图：返回公众号 CDN 上的 url，草稿里要用它替换本地路径。 */
  async uploadContentImage(file: string): Promise<string> {
    const body = await this.upload(
      "上传正文图",
      "/cgi-bin/media/uploadimg?type=image",
      file,
    );
    const url = body.url;
    if (typeof url !== "string" || url === "") {
      throw new Error(`上传正文图失败：响应里没有 url（${file}）`);
    }
    return url;
  }

  /** 封面：永久素材，返回 thumb_media_id。 */
  async uploadCover(file: string): Promise<string> {
    const body = await this.upload(
      "上传封面",
      "/cgi-bin/material/add_material?type=image",
      file,
    );
    const mediaId = body.media_id;
    if (typeof mediaId !== "string" || mediaId === "") {
      throw new Error(`上传封面失败：响应里没有 media_id（${file}）`);
    }
    return mediaId;
  }

  async draftAdd(article: WechatDraftArticle): Promise<string> {
    const body = await this.withToken("新建草稿", async (token) =>
      this.request("新建草稿", `${API}/cgi-bin/draft/add?access_token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ articles: [article] }),
      }),
    );
    const mediaId = body.media_id;
    if (typeof mediaId !== "string" || mediaId === "") {
      throw new Error("新建草稿失败：响应里没有 media_id");
    }
    return mediaId;
  }

  async draftUpdate(mediaId: string, article: WechatDraftArticle): Promise<void> {
    await this.withToken("更新草稿", async (token) =>
      this.request("更新草稿", `${API}/cgi-bin/draft/update?access_token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ media_id: mediaId, index: 0, articles: article }),
      }),
    );
  }

  /**
   * 订阅号没有群发接口权限（48001）。用一个不存在的 publish_id 试探，
   * 只要不是「无权限」就说明这个号能调发布接口。
   */
  async probePublish(): Promise<boolean> {
    const token = await this.token();
    try {
      await this.request(
        "探测发布权限",
        `${API}/cgi-bin/freepublish/get?access_token=${token}&publish_id=probe`,
        { method: "GET" },
      );
    } catch (error) {
      if (error instanceof WechatApiError) {
        return error.errcode !== 48001;
      }
      throw error;
    }
    return true;
  }
}
