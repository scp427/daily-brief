#!/bin/sh
# Mirror the working tree to a report host.
#
# Everything listed in --exclude is either state that only exists on the host
# (.env.local, logs/, daily_reports/, snapshots/) or rebuilt from the lockfile
# (node_modules/). rsync protects excluded paths from --delete, so mirroring
# never removes them; --delete only prunes files that the source tree used to
# have.
set -eu

host=${1:?usage: deploy/sync-code.sh <ssh-host> [remote-path]}
remote=${2:-daily-brief}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

rsync -a --delete \
  --exclude node_modules \
  --exclude logs \
  --exclude daily_reports \
  --exclude snapshots \
  --exclude .git \
  --exclude '*.bak' \
  --exclude '.env*' \
  "$root/" "$host:$remote/"
