# 服务器侧部署

公开站点、数据源管理页与写作页跑在同一台机器的 8180 端口，由 nginx 同时承担静态发布，以及 `/admin/` 与 `/editor/` 两个反代入口。

| 组件 | 位置 | 说明 |
| --- | --- | --- |
| 静态站 | `/www/daily-brief`，nginx `listen 8180` | `daily_reports/` 的镜像，由 `deploy/publish.sh` 同步；`/` 为最新一期，`/archive.html` 为历史列表 |
| 管理页 | `http://<host>:8180/admin/` | 源码 `scripts/admin/index.html`；数据源表格、分类配置与写作面板可切换 |
| 写作页 | `http://<host>:8180/editor/` | 同一份页面的只写作视图：隐藏数据源表格与视图切换，直接进写作面板 |
| 管理 API | `daily-brief-admin.service` → `127.0.0.1:8183` | 源码 `scripts/admin-server.ts`，`Restart=always`；数据源增删改查、单源测试、分类配置读写、写作任务（提交/轮询/取稿与审阅结论） |
| 每日发布 | `~/bin/daily-publish.sh`（cron 08:00、17:00） | run-daily → build-site → `deploy/publish.sh` |

`make daily`、`make render`、`make site` 的末尾都调 `deploy/publish.sh`，所以手动重渲染同样会同步到 8180；目标目录不存在时它打印 `skipped` 并以 0 退出，本地与 CI 靠这条跑通同一套 Makefile。

## 安装 / 更新

```sh
# 管理服务（需要 root 写 systemd unit）
sudo DAILY_BRIEF_USER=<user> bash deploy/install-admin.sh

# nginx 站点 + /admin/ 与 /editor/ 反代
sudo DAILY_BRIEF_USER=<user> bash deploy/install-nginx.sh
```

两个脚本都以自身所在目录的上一层作为应用目录，`DAILY_BRIEF_USER` 省略时取 `$SUDO_USER`；没有该变量则直接报错，不猜测用户。

`install-admin.sh` 把 `deploy/daily-brief-admin.service.in` 里的 `@USER@` / `@HOME@` / `@APP@` 替换成实际账号与路径后写入 `/etc/systemd/system/`，仓库里不保留机器相关的路径。`install-nginx.sh` 从本目录的 `nginx-daily-brief.conf` 安装站点配置。

## 代码同步

服务器上的应用目录（如 `~/daily-brief`）是工作副本，不是 git 仓库，代码从开发机推过来：

```sh
deploy/sync-code.sh <host> ~/daily-brief
```

脚本用 `rsync -a --delete` 镜像工作树，排除项就是契约：`node_modules/` 按 lockfile 重建，`logs/`、`daily_reports/`、`snapshots/` 是服务器自己的运行产物，`.env.local` 只写在服务器上（LLM key、`SNAPSHOT_REPO`），`notify.config.json` 只写在服务器上（收件地址与 SMTP 主机），`.git/` 在服务器上不存在。rsync 不对被排除的路径执行 `--delete`，所以这些文件既不会被覆盖也不会被删除。

`package.json` 未变时服务器上不需要 `npm install`。`daily-brief-admin.service` 常驻内存，`lib/` 改动后要 `sudo systemctl restart daily-brief-admin.service` 才会生效。

## 认证

数据接口要求 `Authorization: Bearer <token>`，令牌在 `~/.daily-brief-admin-token`（`0600`，首次启动生成）。页面首次打开要求粘贴令牌，存 `localStorage`。`/admin/api/health` 免认证，只返回源数量。

## 页面入口

`/admin/` 顶部三个按钮：`新增数据源`（展开新增表单，再点收起）、`分类配置`（展开 `categories.config.json` 的 JSON 编辑器）、`刷新`。下方两排勾选框分别按分类与状态（已启用 / 已停用 / 最近失败）过滤；勾选为空等于不过滤。数据源名称直接链到它的 `url`，新窗口打开。

分类编辑器走 `GET /api/categories` 与 `PUT /api/categories`：页面先本地 `JSON.parse`，服务端再用 `validateCategoriesConfig` 校验，通过才落盘。保存只影响下一次 `daily` / `render` 运行，已生成的报告要重跑那次 render 才会变。

## 写入与恢复

- 任何写操作前把被写的文件复制为 `<name>.bak`（`sources.config.json.bak`、`categories.config.json.bak`，均已 gitignore），写入用 tmp + rename。
- 写后立即用 `lib/sources/config.ts` 的 `validateSourceConfig` 或 `lib/categories.ts` 的 `validateCategoriesConfig` 校验；校验失败不会落盘，接口返回 400 与失败原因。
- 抓取结果落 `logs/source-status.json`，`daily` / `dry-run` / 管理页「测试」三处共用 `lib/sources/run.ts` 的记录逻辑。

## 分类与面板

`categories.config.json` 是唯一的分类事实来源：`tech` / `politics` / `finance` 三个 L1 面板、每个分类的 L2 子分类顺序、每源条数上限（`displayLimit`）、合并列表条数（`mergeLimit`）、digest 条数要求（`digestCount`）、`fallbackLimit`、`payloadLimit`，以及 `extraPanels`（把某分类的子分类拆成独立顶部 tab，例如 `community`）和 `tradingPanel` 的插入位置。

- `lib/categories.ts` 在进程启动时读取并校验该文件；字段缺失、id 重复、`extraPanels` 引用未声明的子分类都会 fail loud 退出，不会静默降级。
- 新增分类需要同时在该文件加条目并给数据源填对应 `category` / `subcategory`，`lib/sources/config.ts` 会用同一份声明校验 `sources.config.json`。
- 改完分类后必须重跑一次 `npm run daily`（或 `npm run render <date>`）才能看到新面板；HTML 面板只由分类配置 + 当日 sidecar 决定，不经过 LLM。
