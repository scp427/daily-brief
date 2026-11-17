# daily-brief 本地运维入口。
#
# 两个常驻服务（管理 API、静态站预览）在这里启停；其余是一次性任务。
# 生产环境的 systemd / nginx 由 deploy/ 下的脚本管理，不走这个 Makefile。

SHELL := /bin/bash
.DEFAULT_GOAL := help

# 直接调用 node 与 node_modules/.bin，不依赖 npm / tsx / npx 在 PATH 上：
# 远程部署机只装了 node，没有 npm。
RUN  := node scripts/run-tsx.mjs
TSC  := node_modules/.bin/tsc
TEST := node --import tsx --test

DATE ?= $(shell date +%F)
ADMIN_HOST ?= 127.0.0.1
ADMIN_PORT ?= 8183
PREVIEW_PORT ?= 8180
PLATFORM ?=
PICKS ?=
FORCE ?=
# 空 = config-check 自动取 daily_reports/ 下最新一天
CHECK_DATE ?=

PID_FILE := logs/admin-server.pid
LOG_FILE := logs/admin-server.log
HEALTH_URL := http://$(ADMIN_HOST):$(ADMIN_PORT)/api/health
# Unit name used by the deployed host. Local `make admin-start` never uses it.
ADMIN_SERVICE ?= daily-brief-admin.service

.PHONY: help install test typecheck config-check daily freshness render digest site publish preview \
        admin-start admin-stop admin-restart admin-status admin-logs wechat piece review push

help:
	@awk 'BEGIN {FS = ":.*## "} \
	  /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "  变量：DATE=$(DATE)  PLATFORM=$(if $(strip $(PLATFORM)),$(PLATFORM),（空）)  ADMIN_PORT=$(ADMIN_PORT)  PREVIEW_PORT=$(PREVIEW_PORT)"
	@echo "  例：make wechat PICKS=\"Russian attacks\" PLATFORM=wechat,weibo"

install: ## 安装依赖（npm ci）
	npm ci

test: ## 跑全部测试
	$(TEST) lib/*.test.ts lib/output/*.test.ts lib/ai/*.test.ts lib/ai/backends/*.test.ts \
	  lib/publish/*.test.ts lib/sources/*.test.ts scripts/*.test.mjs

typecheck: ## TypeScript 类型检查
	$(TSC) --noEmit

config-check: ## 校验两份配置的交叉引用 + sidecar 一致性（CHECK_DATE=YYYY-MM-DD 指定日期）
	@$(RUN) scripts/config-check.ts $(CHECK_DATE)

daily: ## 生成当天报告并发布（抓源 + 富化 + digest）
	$(RUN) scripts/daily.ts
	node scripts/build-site.mjs
	sh deploy/publish.sh

freshness: ## 检查各源最新文章日期（D=天数，FORCE=1 停用超期源）
	$(RUN) scripts/freshness.ts --days $(or $(D),14) $(if $(FORCE),--disable-stale)

render: ## 只重渲染指定日期并发布（DATE=YYYY-MM-DD）
	$(RUN) scripts/render.ts $(DATE)
	node scripts/build-site.mjs
	sh deploy/publish.sh

digest: ## 用当日 sidecar 重新生成 digest（不重新抓取，会调 LLM）
	$(RUN) scripts/regen-digest.ts $(DATE)

site: ## 生成静态站并发布到 nginx 根目录
	node scripts/build-site.mjs
	sh deploy/publish.sh

# 镜像到 nginx 根目录；SITE_DIR 覆盖目标，目标不存在时跳过（本地与 CI 如此）。
publish: ## 把 daily_reports/ 镜像到 nginx 根目录（SITE_DIR=/www/daily-brief）
	sh deploy/publish.sh

preview: site ## 生成本地静态站并起预览服务（Ctrl-C 退出）
	@echo "预览：http://127.0.0.1:$(PREVIEW_PORT)/"
	@python3 -m http.server $(PREVIEW_PORT) --bind 127.0.0.1

wechat: ## 选稿并写作（PICKS 必填，见 help 里的示例）
ifeq ($(strip $(PICKS)),)
	@echo '用法：make wechat PICKS="<标题子串|URL>" [PLATFORM=wechat,weibo,xiaohongshu] [FORCE=1]'
	@echo "多篇用空格分开；某篇标题含空格时给它再包一层引号："
	@echo "  make wechat PICKS='\"Russian attacks\" https://example.com/a'"''
	@exit 2
else
	@$(RUN) scripts/wechat.ts $(DATE) $(PICKS) $(if $(strip $(PLATFORM)),--platform=$(PLATFORM)) $(if $(strip $(FORCE)),--force)
endif

piece: ## 写聚合稿：topic 主题稿 / digest 资讯汇总
ifeq ($(strip $(PIECE)),)
	@echo '用法：'
	@echo '  make piece PIECE=topic TOPIC="英伟达财报" PICKS="<标题子串|URL> ..."'
	@echo '  make piece PIECE=digest CATEGORY=tech,finance'
	@echo '多篇 PICKS 用空格分开；某篇标题含空格时给它再包一层引号。'
	@exit 2
else
	@$(RUN) scripts/piece.ts $(DATE) $(PIECE) $(if $(strip $(TOPIC)),--topic=$(TOPIC)) $(if $(strip $(CATEGORY)),--category=$(CATEGORY)) $(if $(strip $(PICKS)),$(PICKS)) $(if $(strip $(FORCE)),--force)
endif

push: ## 把已审阅的草稿推进公众号草稿箱（SLUG 必填）
ifeq ($(strip $(SLUG)),)
	@echo '用法：'
	@echo '  make push SLUG=topic-英伟达财报-1a2b3c'
	@echo '  make push SLUG=digest-2026-11-17 THEME=brief'
	@echo '凭证：~/.daily-brief-wechat.json（app_id / app_secret / cover）'
	@exit 2
else
	@$(RUN) scripts/push.ts $(DATE) $(SLUG) $(if $(strip $(THEME)),--theme=$(THEME)) $(if $(strip $(FORCE)),--force) $(if $(strip $(DRY)),--dry-run)
endif

review: ## 审阅当日草稿（PLATFORM 为空则审阅当天全部草稿）
	@$(RUN) scripts/review.ts $(DATE) $(if $(strip $(PLATFORM)),--platform=$(PLATFORM)) $(if $(strip $(FORCE)),--force)

admin-start: ## 后台启动管理 API（loopback:$(ADMIN_PORT)）
	@mkdir -p logs
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	  echo "admin 已在运行：pid $$(cat $(PID_FILE))"; \
	  exit 0; \
	fi
	@if curl -fsS --max-time 1 $(HEALTH_URL) > /dev/null 2>&1; then \
	  echo "$(ADMIN_PORT) 端口已有服务应答（$(HEALTH_URL)），本次不启动。"; \
	  echo "该端口由服务管理器托管：sudo systemctl restart $(ADMIN_SERVICE)"; \
	  exit 1; \
	fi
	@rm -f $(PID_FILE)
	@set -m; nohup $(RUN) scripts/admin-server.ts >> $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@for i in $$(seq 1 60); do \
	  if curl -fsS --max-time 1 $(HEALTH_URL) > /dev/null 2>&1; then \
	    echo "admin 就绪：$(HEALTH_URL)（pid $$(cat $(PID_FILE))，日志 $(LOG_FILE)）"; \
	    exit 0; \
	  fi; \
	  sleep 0.25; \
	done; \
	echo "admin 启动后 15s 内未响应，见 $(LOG_FILE)"; exit 1

admin-stop: ## 停止管理 API
	@if [ ! -f $(PID_FILE) ]; then \
	  if curl -fsS --max-time 2 $(HEALTH_URL) > /dev/null 2>&1; then \
	    echo "无 $(PID_FILE)，但 $(ADMIN_PORT) 有服务应答：由 $(ADMIN_SERVICE) 托管，不受 admin-stop 管理。"; \
	    echo "  sudo systemctl stop $(ADMIN_SERVICE)"; \
	    exit 1; \
	  fi; \
	  echo "admin 未在运行（无 $(PID_FILE)）"; exit 0; \
	fi
	@pid=$$(cat $(PID_FILE)); \
	if ! kill -0 $$pid 2>/dev/null; then \
	  echo "pid $$pid 已不存在，清理 pid 文件"; rm -f $(PID_FILE); exit 0; \
	fi; \
	kill -TERM -$$pid 2>/dev/null || kill -TERM $$pid; \
	for i in $$(seq 1 40); do kill -0 $$pid 2>/dev/null || break; sleep 0.25; done; \
	if kill -0 $$pid 2>/dev/null; then \
	  echo "未响应 TERM，发送 KILL"; kill -KILL -$$pid 2>/dev/null || kill -KILL $$pid; \
	fi; \
	rm -f $(PID_FILE); echo "admin 已停止"

admin-restart: ## 重启管理 API（nohup 与 systemd 两种托管形态）
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	  $(MAKE) --no-print-directory admin-stop && $(MAKE) --no-print-directory admin-start; \
	elif curl -fsS --max-time 1 $(HEALTH_URL) > /dev/null 2>&1; then \
	  if sudo -n systemctl restart $(ADMIN_SERVICE) 2>/dev/null; then \
	    echo "已通过 systemctl 重启 $(ADMIN_SERVICE)"; \
	  else \
	    pid=$$(pgrep -f "scripts/admin-server[.]ts" | head -1); \
	    if [ -z "$$pid" ]; then \
	      echo "$(ADMIN_PORT) 有服务应答但找不到 admin-server 进程，无法自行重启。"; \
	      echo "  sudo systemctl restart $(ADMIN_SERVICE)"; exit 1; \
	    fi; \
	    echo "无免密 sudo；向 $(ADMIN_SERVICE) 的主进程 $$pid 发 TERM，由 Restart=always 拉起新代码"; \
	    kill -TERM $$pid 2>/dev/null || { echo "kill $$pid 失败：sudo systemctl restart $(ADMIN_SERVICE)"; exit 1; }; \
	    for i in $$(seq 1 20); do kill -0 $$pid 2>/dev/null || break; sleep 0.25; done; \
	  fi; \
	  for i in $$(seq 1 40); do \
	    if curl -fsS --max-time 1 $(HEALTH_URL) > /dev/null 2>&1; then \
	      echo "admin 就绪：$(HEALTH_URL)"; exit 0; \
	    fi; \
	    sleep 0.25; \
	  done; \
	  echo "重启后 10s 内无响应，见 journalctl -u $(ADMIN_SERVICE) -n 30"; exit 1; \
	else \
	  $(MAKE) --no-print-directory admin-start; \
	fi

admin-status: ## 查看管理 API 进程与健康状态
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
	  echo "进程：运行中（pid $$(cat $(PID_FILE))，nohup 方式）"; \
	elif curl -fsS --max-time 2 $(HEALTH_URL) > /dev/null 2>&1; then \
	  echo "进程：运行中（无 $(PID_FILE)，由 $(ADMIN_SERVICE) 托管）"; \
	else \
	  echo "进程：未运行"; \
	fi
	@curl -fsS --max-time 2 $(HEALTH_URL) 2>/dev/null && echo || echo "健康检查：无响应（$(HEALTH_URL)）"

admin-logs: ## 跟踪管理 API 日志（Ctrl-C 退出）
	@mkdir -p logs
	@tail -f $(LOG_FILE)
