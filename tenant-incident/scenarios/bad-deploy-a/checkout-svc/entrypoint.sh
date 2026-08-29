#!/bin/sh
# Run the build named by $BUILD. inject.sh sets BUILD to the regressed build to
# "deploy" it; reset.sh sets it back to the baseline to roll back. The two build
# sources sit side by side so the diff between them is the change-lens evidence.
set -e
BUILD="${BUILD:-2026.08.20}"
APP="app-${BUILD}.js"
if [ ! -f "$APP" ]; then
  echo "entrypoint: no source for build '$BUILD' ($APP not found)" >&2
  exit 1
fi
exec node "$APP"
