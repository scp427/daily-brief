# 📰 daily-brief · 10 分钟拥有你自己的 AI 每日简报

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![LLM: pluggable](https://img.shields.io/badge/LLM-pluggable%20(6%20backends)-orange.svg)](#llm-后端)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6.svg)](https://www.typescriptlang.org/)

抓取 → 摘要 → 渲染 → 发布，一条命令跑完。默认 31 个数据源、21 个行情标的技术指标、6 个 LLM 后端可切换，产出单文件 HTML；同一批数据还能写成公众号稿件并推进草稿箱。

基于 [leiting-eric/DailyBrief](https://github.com/leiting-eric/DailyBrief) 二次开发。

---

## 特性

- **多源聚合**：58 个源注册在案，默认启用 31 个（zh 模式有效 30、en 模式有效 24），覆盖科技、财经、时政、社区
- **行情面板**：21 个美股 / 加密 / 中港 / 商品外汇标的，附 SMA、RSI、MACD 与 LLM 交易点评
- **LLM 可插拔**：`claude-cli` / `anthropic` / `openai` / `deepseek` / `minimax` / `zhipu`，一个环境变量切换
- **单文件 HTML**：CSS 与 JS 全内联，无外部资源，一份文件即可托管
- **定时 + 快照**：本机定时器出报告；境外源由 GitHub Actions 抓快照绕开网络限制
- **公众号写作**：用当日数据写主题稿或资讯汇总，三种版式渲染成公众号 HTML，预览后写进草稿箱
- **零 key 数据源**：全部走公开 RSS / JSON 端点

---

## 快速开始

三种方式选一种。都需要 Node 20+；本地方式还需要 git。

### A. 本地一键装

```bash
curl -sSL https://raw.githubusercontent.com/scp427/daily-brief/main/bootstrap.mjs | node
```

脚本会检查依赖、克隆到 `~/daily-brief`、`npm install`、注册系统定时（Task Scheduler / launchd / cron，默认 08:00）、跑一次 `dry-run` 烟测。可用 `--target` 换目录、`--at 07:30` 换时间、`--skip-scheduler` 不注册定时。

手动安装等价于：

```bash
git clone https://github.com/scp427/daily-brief.git && cd daily-brief
npm install
node scripts/install.mjs --at 07:30 --global   # --global 额外把 skill/commands 链到 ~/.claude/
npm run dry-run                                # 只抓取，不调 LLM
```

### B. GitHub Actions + Pages

Fork 后在仓库 Settings 里做三件事：Actions → Workflow permissions 设成 **Read and write**；Secrets and variables → Actions 加 API key（如 `DEEPSEEK_API_KEY`）**和** 变量 `LLM_BACKEND`（如 `deepseek`，两者缺一即报错）；Pages → Source 选分支 `gh-pages`（首次跑完才出现）。之后在 Actions 标签手动触发一次，报告落在 `https://<user>.github.io/<repo>/`。

触发时间是 UTC cron + `REPORT_TZ` 换算的门禁，所以填 `REPORT_TZ=Asia/Shanghai` 即可按本地时间跑；`REPORT_HOUR`、`REPORT_DAYS` 控制几点与星期几，`REPORT_LOCALE` 切中英文。注意 Actions 里用不了本机已登录的 `claude` CLI。

### C. 交给 AI Agent

把仓库地址和「按 README 的本地一键装流程跑 bootstrap，完成后告诉我下次触发时间」发给 Claude Code / Cursor / Codex 均可。仓库内有 `AGENTS.md` 与 `.claude/skills/daily-brief/SKILL.md` 说明这套管线。

---

## 日常命令

```bash
npm run daily                 # 完整跑一次（≈5-8 min）
npm run dry-run               # 只抓取，验证源是否正常
npm run render [date]         # 重渲染本地 HTML（不调 LLM）
npm run build-site            # 生成静态站 index.html / archive.html
npm run regen-digest [date]   # 用当日已抓文章重写摘要
npm run regen-trading [date]  # 重做行情与点评
npm run regen-enrich <cat:sub> [date]   # 补缺失摘要，也可用来验证 LLM 配置
npm run sources               # 列源 + locale 有效数
npm run sources:check         # 只校验 sources.config.json
npm run config-check [date]   # 源配置 × 分类配置 × 当日 sidecar 一致性
npm run freshness             # 逐源检查最新文章日期
npm run quota-report          # LLM 用量统计
npm run notify [date]         # 用已生成的报告发一次概览邮件
```

`Makefile` 是同一个管线的快捷入口（`make help` 看全部）：`make daily`、`make render`、`make site`、`make publish`、`make admin-start`、`make piece`、`make review`、`make push`。其中 `make daily` / `make render` 末尾会顺带 `build-site` + `publish`，把新报告镜像到 nginx 根目录。

---

## 邮件概览通知

每次 `npm run daily` 写完报告后，可以把「头条 + 总览 + 每类一条要点 + 行情点评」发到邮箱。配置在 `notify.config.json`——它含收件地址，已被 `.gitignore` 排除；首次使用先复制模板：

```bash
cp notify.config.example.json notify.config.json
```

```json
{
  "enabled": true,
  "channels": ["email"],
  "email": {
    "host": "smtp.qq.com", "port": 465, "secure": true,
    "from": "you@qq.com", "to": ["you@qq.com"],
    "subjectPrefix": "[每日简报]"
  },
  "maxBullets": 6,
  "baseUrl": "https://your-host/daily-brief"
}
```

- SMTP 授权码只从环境变量 `NOTIFY_SMTP_PASS` 读，写进 `.env.local`；`enabled` 为 `false` 时不需要它
- `baseUrl` 留空则邮件不附全文链接；填了就拼成 `${baseUrl}/<date>/<date>.html`，与 nginx 镜像目录一致
- 配置写错会在管线启动时直接报错，不会等跑完 5-8 分钟才发现；SMTP 投递失败只记警告，不影响报告与退出码
- `regen-*`、`snapshot` 不推送，避免同一天重复发信
- GitHub Actions 里的 `daily.yml` 也会跑 `npm run daily`：`enabled: true` 时要在 Secrets 里加 `NOTIFY_SMTP_PASS`，否则那次运行会按配置错误失败。飞书/Server 酱这类 Webhook 可在 `lib/notify/` 下加一个实现接入
- 先 `npm run notify -- --dry-run` 看渲染结果，再去掉 `--dry-run` 真发一封
- 新增渠道只需在 `lib/notify/` 加一个实现并在 `config.ts` 的 `KNOWN_CHANNELS` 登记

---

## 写作与推送

### 从 CLI 写稿

```bash
npm run piece -- topic --topic="主题" <url|标题子串>...   # 多篇报道综合成一篇主题稿
npm run piece -- digest --category=tech,finance          # 当日摘要改成资讯汇总
npm run wechat -- [date] <url|标题子串>                   # 单篇原文改写
npm run review -- [date]                                 # 结构 / 外链机械检查 + 模型核对事实
npm run push -- <slug>                                   # 渲染公众号 HTML 并写进草稿箱
```

产物落在 `daily_reports/<date>/pieces/<slug>/`：`wechat.md`、`wechat.json`、`materials.json`（进入 prompt 的编号化素材，审阅读同一份）、`assets/`。主题稿里每个事实都对应素材编号，来源冲突要求并列陈述；稿件不写"据某网报道"这类署名，机械检查会把它们判成 high。

### 管理页与写作面板

```bash
make admin-start      # 127.0.0.1:8183，令牌在 ~/.daily-brief-admin-token
```

两个入口共用同一进程、令牌与任务队列：`/admin/` 可在数据源与写作之间切换，`/editor/` 直接进写作面板。写作走「提交任务 → 轮询进度 → 取结果」，因为写一篇要 20-60s，超过 nginx 对反代的 60s 读超时；同一时刻只跑一个写作任务。

### 公众号版式

微信编辑器会剥掉 `<style>` / `class` / `id`，所以 `lib/publish/wechat-html.ts` 输出内联样式。`--theme=` 选版式，不填时主题稿用 `journal`、汇总稿用 `brief`：

| id | 形态 |
|---|---|
| `journal` | 小标题带 `01` 序号与左侧色条，首段略大，正文 15.5px / 行高 1.85 |
| `brief` | 小标题是浅色底圆角标签，条目间虚线分隔 |
| `plain` | 只有字号与行高 |

凭据放 `~/.daily-brief-wechat.json`（0600），并在公众号后台把服务器出口 IP 加进白名单，否则返回 40164：

```json
{ "app_id": "wx...", "app_secret": "...", "cover": "/path/to/cover.png" }
```

`cover` 是封面图（草稿接口必填）。审阅结论不是 `pass` 时拒绝推送，`--force` 可越过；重复推送复用 `thumb_media_id` 走 `draft/update`，不新建草稿。`npm run push -- --probe` 可探测该号能否直接调发布接口（48001 表示只能写草稿）。

---

## 数据源

所有源集中在 `sources.config.json`（唯一入口，改 JSON 即可增删启停）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 全局唯一，dispatch 用它路由抓取器 |
| `name` | ✓ | 显示名 |
| `type` | ✓ | `rss` / `api` / `scrape` |
| `url` | ✓ | feed 或 endpoint |
| `category` | ✓ | `tech` / `finance` / `politics` / `community`，决定一级 tab |
| `subcategory` | | 二级分组，取值随 `category` 而定，须在 `categories.config.json` 声明 |
| `enabled` | | 默认 `true`，`false` 保留记录但跳过 |
| `useCurl` | | 被 Cloudflare 拦 TLS 指纹时改走 `curl` 子进程 |
| `domestic` | | `true` 表示大陆可直连；`false` 走 Actions 快照 |
| `lang` | | `zh` 表示中文内容，enrich 跳过不译 |
| `locales` | | 出现在哪些 report locale，默认 `["zh","en"]` |
| `notes` | | 备注，运行时忽略 |

`category` 与 `subcategory` 必须是 `categories.config.json` 里已声明的 id；**启用源**写错组合时 `sources:check`、管理 API 与 `npm run daily` 启动都会报错，停用源保留旧 subcategory 便于回滚。

### 面板与条数

`categories.config.json` 定义一级 tab、二级分组、每源条数上限与 digest 条数要求（`digestCount`、`payloadLimit`、`fallbackLimit`、`summaryStyle`，二级分组可带 `displayLimit` / `subLimit` / `mergeLimit`）。改分类不必抓数据：rendering 按源当前的分类归桶，只有被删源的文章才会退回抓取时的类别。每个列表首屏渲染 20 条，其余写进 `<date>-overflow/` 片段，滚动到底再取。

### 境外源与快照

`domestic` 不为 `true` 的源由 `.github/workflows/snapshot.yml` 在 GitHub runner 上抓取（每天 4 次，早于报告生成），结果提交到 `snapshots` 分支。报告主机设 `SNAPSHOT_REPO=owner/name` 打开读取，`SNAPSHOT_PREFER=true` 时优先读快照；超过 26 小时的快照按缺失处理。未认证的 `api.github.com` 每小时仅 60 次请求，配 `SNAPSHOT_TOKEN` 提到 5000。手动补抓：`npm run snapshot -- --only bbc-business,guardian-world`。

### 中英切换

`REPORT_LOCALE=zh|en` 决定参与抓取的源、HTML 文案、三套 prompt、stance 用词与日期格式。源的 `locales` 字段决定它属于哪个模式；当前 zh 有效 30 个源、en 有效 24 个。

---

## LLM 后端

| backend | key 变量 | 默认模型 |
|---|---|---|
| `claude-cli`（默认） | 无，复用 Claude Code 登录 | `sonnet` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` |
| `minimax` | `MINIMAX_API_KEY` | `MiniMax-M2.7`（大陆用 `MINIMAX_BASE_URL=https://api.minimaxi.com/v1`） |
| `zhipu` | `ZHIPU_API_KEY` | `claude-sonnet-4-6` |

本地配置写在仓库根的 `.env.local`（`cp .env.example .env.local`），TypeScript 入口第一行就 dotenv 预加载。任意兼容服务用通用别名即可：

```bash
LLM_BACKEND=openai
LLM_API_KEY=<key>
LLM_BASE_URL=https://api.moonshot.cn/v1
LLM_MODEL=moonshot-v1-8k        # 自托管 / 中转必须显式指定
```

`LLM_MODEL`、`LLM_API_KEY`、`LLM_BASE_URL` 对任意 backend 生效；协议是 Anthropic 的走 `LLM_BACKEND=anthropic` + `ANTHROPIC_BASE_URL`。启动期会校验 key 是否与 `LLM_BACKEND` 匹配，配错在 1 秒内报出具体缺哪个变量。想验证配置是否通：`npm run regen-enrich -- finance:news`（≈30 秒，1 次调用）。

---

## 部署

自托管完整流程见 [`deploy/README.md`](deploy/README.md)：静态站由 nginx 从 `/www/daily-brief` 提供（`deploy/publish.sh` 镜像 `daily_reports/`），`/admin/` 与 `/editor/` 反代到 `127.0.0.1:8183`，服务由 `daily-brief-admin.service` 常驻。安装脚本 `deploy/install-nginx.sh`、`deploy/install-admin.sh` 从仓库模板渲染出账户与路径，仓库里不存机器相关取值；`deploy/sync-code.sh <host> <dir>` 用 rsync 同步工作树。

只把报告推到已有服务器更简单：`.env.local` 里设 `DEPLOY_HOST=user@host` 与 `DEPLOY_PATH=/var/www/site`，之后每次 `npm run daily` 自动 scp，失败不阻断当天出报；`npm run deploy [date]` 可补推。

## 项目结构

```
lib/
  sources/    抓取器（RSS / API / scrape / curl）+ 快照读取
  ai/         后端适配、prompt、摘要与管线
  trading/    Yahoo Finance、指标计算、点评
  output/     HTML / Markdown 渲染、sidecar 读写、按当前分类归桶
  publish/    选稿、写作、审阅、公众号 HTML、草稿箱推送
scripts/      daily / render / piece / review / push / admin-server / install 等入口
deploy/       nginx 站点、systemd 模板、发布与同步脚本
.claude/      Claude Code skill 与 slash command
```

`daily_reports/` 存产出（gitignored），每日一个子目录，含 `.html`、`.json` 缓存与 `-articles.json` 正文缓存；管理页与稿件都读这份 sidecar。`logs/llm-calls.jsonl` 记录每次模型调用。

## 致谢

感谢源项目 [leiting-eric/DailyBrief](https://github.com/leiting-eric/DailyBrief)：抓取、摘要、渲染这条管线由它起步，本仓库在此基础上继续开发。

## License

MIT
