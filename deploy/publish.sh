#!/bin/sh
# Mirror the built reports into the host's nginx root.
#
# SITE_DIR defaults to the root deploy/nginx-daily-brief.conf serves. A host
# that has no such directory — a laptop, GitHub Actions — publishes nothing
# and says so; the reports in daily_reports/ are still written.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
reports="$root/daily_reports"
site=${SITE_DIR:-/www/daily-brief}

if [ ! -d "$reports" ]; then
  echo "[publish] no reports: $reports is missing — run \`make daily\` first" >&2
  exit 1
fi

if [ ! -d "$site" ]; then
  echo "[publish] skipped: $site does not exist (set SITE_DIR to publish elsewhere)"
  exit 0
fi

rsync -a --delete --chmod=D755,F644 "$reports/" "$site/"
echo "[publish] $reports -> $site"
