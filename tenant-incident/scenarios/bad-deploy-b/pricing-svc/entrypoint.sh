#!/bin/sh
# Run the build named by $BUILD. inject.sh sets BUILD to the regressed build to
# "deploy" it; reset.sh sets it back to the baseline to roll back. Both build
# sources sit side by side so the diff between them is the change-lens evidence.
set -e
BUILD="${BUILD:-2026.09.02}"
MODULE="app_$(echo "$BUILD" | tr '.' '_')"
if [ ! -f "${MODULE}.py" ]; then
  echo "entrypoint: no source for build '$BUILD' (${MODULE}.py not found)" >&2
  exit 1
fi
exec uvicorn "${MODULE}:app" --host 0.0.0.0 --port 8000 --workers 1
