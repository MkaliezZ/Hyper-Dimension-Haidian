#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -f PACKAGE-MANIFEST.json ]; then node scripts/verify-package.mjs; fi
node scripts/verify.mjs
exec node server.mjs
