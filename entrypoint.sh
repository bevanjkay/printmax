#!/bin/sh
# Starts as root so a bind-mounted or pre-existing /data can be handed to the `node` user,
# then drops privileges. With `--user` set, the container never runs as root and this is a no-op.
set -eu

data_dir="${DATA_DIR:-/data}"
upload_dir="${UPLOAD_DIR:-$data_dir/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_dir" "$upload_dir"
  chown -R node:node "$data_dir" "$upload_dir" 2>/dev/null || true
  exec setpriv --reuid="$(id -u node)" --regid="$(id -g node)" --init-groups "$@"
fi

exec "$@"
