#!/usr/bin/env bash
set -euo pipefail
# Install only into an explicitly selected, initially absent service directory.
# System prerequisites: curl, git, tar, xz-utils, Java 21, PostgreSQL client/server.
ROOT="${1:?Usage: bash tools/m0-install-ubuntu.sh /absolute/new-service-root}"
BASE="$(cd "$(dirname "$0")/.." && pwd)"
case "$ROOT" in /*) ;; *) echo 'An absolute service root is required' >&2; exit 1;; esac
if [ -e "$ROOT" ]; then echo 'Refusing to overwrite an existing service root' >&2; exit 1; fi
for cmd in curl git tar sha256sum java psql; do command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 1; }; done
mkdir -p "$ROOT/downloads" "$ROOT/node" "$ROOT/keycloak" "$ROOT/nakama"
CACHE="${HD_DOWNLOAD_CACHE:-$BASE/integrations/download-cache}"
download() {
  if [ -f "$CACHE/$1" ]; then
    cp "$CACHE/$1" "$ROOT/downloads/$1"
  else
    curl -4 --fail --location --connect-timeout 15 --max-time 180 --retry 2 --retry-all-errors --silent --show-error --output "$ROOT/downloads/$1" "$2"
  fi
  printf '%s  %s\n' "$3" "$ROOT/downloads/$1" | sha256sum -c -
}
download node.tar.xz https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz 6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
download keycloak.tar.gz https://github.com/keycloak/keycloak/releases/download/26.8.1/keycloak-26.8.1.tar.gz 4e2740b181faa2ea623a1c2ecf00855935311e546046e2f857615a47ed24cbe8
download nakama.tar.gz https://github.com/heroiclabs/nakama/releases/download/v3.41.0/nakama-3.41.0-linux-amd64.tar.gz 71aea14384b097e043917d0b1e8c3799594064acbab01853e71ea10d80624ce2
tar -xJf "$ROOT/downloads/node.tar.xz" -C "$ROOT/node" --strip-components=1
tar -xzf "$ROOT/downloads/keycloak.tar.gz" -C "$ROOT/keycloak" --strip-components=1
tar -xzf "$ROOT/downloads/nakama.tar.gz" -C "$ROOT/nakama"
export PATH="$ROOT/node/bin:$PATH"
if [ -d "$CACHE/nodebb.git" ]; then
  git clone --no-hardlinks "$CACHE/nodebb.git" "$ROOT/nodebb"
  git -C "$ROOT/nodebb" checkout --detach 3da90f67b07ea1ca286f2ad2d08e7813a01ab2f9
else
  git clone --depth 1 --branch v4.16.3 https://github.com/NodeBB/NodeBB.git "$ROOT/nodebb"
fi
test "$(git -C "$ROOT/nodebb" rev-parse HEAD)" = 3da90f67b07ea1ca286f2ad2d08e7813a01ab2f9
node "$BASE/tools/m0-patch-nodebb.cjs" "$ROOT/nodebb"
cp "$BASE/integrations/nodebb-upstream/package-lock.json" "$ROOT/nodebb/package-lock.json"
(cd "$ROOT/nodebb"; npm ci --omit=dev --ignore-scripts --no-audit --no-fund; node node_modules/esbuild/install.js)
test -f "$ROOT/nodebb/node_modules/nodebb-plugin-hd-base/plugin.json"
printf 'Installed pinned M0 services into %s\nNext: tools/m0-init.mjs (see docs/M0.md)\n' "$ROOT"
