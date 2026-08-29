#!/usr/bin/env bash
# Corpus-deposit helper (U1 fallback, ADR-0009 + ADR-0015): turn a sandbox-
# produced patch into a SIGNED, LABELLED corpus-deposit PR — locally, with the
# scoped push token held HERE (never in the sandbox). Human-gated: pushes/opens a
# PR only with --push; otherwise it dry-runs (creates the branch in an isolated
# worktree, applies the patch, and prints exactly what it would push).
#
# The durable marker (author = incident-responder, Incident-* trailers) is set in
# the SANDBOX and rides the patch; `git am` preserves it. This helper reads those
# trailers back off the applied commit and DERIVES the branch, title, label, and
# body from them — the surface markers restate the commit, they never invent it.
#
# Usage: patch-to-pr.sh <patch-file> [--push]
# Token resolution for --push (never echoed), first hit wins:
#   1. $GITHUB_TOKEN / $GH_TOKEN in the environment
#   2. macOS Keychain generic password  service=ember-github-push-token account=$USER
# The token never enters the repo, the sandbox, or the command line.
set -euo pipefail

PATCH="${1:?patch file required}"
PUSH="${2:-}"

# Repo root is derived from this script's own location (tools/…), so the helper
# is not tied to any one machine's checkout path.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
AGENT_AUTHOR_EMAIL="incident-responder@ember.invalid"
KEYCHAIN_SERVICE="ember-github-push-token"
LABEL="corpus-deposit"
WT="$(mktemp -d)/wt"
BODY_FILE="$(mktemp)"
CREATED_BRANCH=""   # local scratch branch to reap on exit (remote push is independent)

cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$WT")"
  rm -f "$BODY_FILE"
  # the branch lives in the worktree while checked out, so delete it only after
  # the worktree is gone; the pushed remote branch is unaffected.
  if [ -n "$CREATED_BRANCH" ]; then
    git -C "$REPO_ROOT" branch -D "$CREATED_BRANCH" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Resolve the scoped push token without ever echoing it: env first, then Keychain.
resolve_token() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then printf '%s' "$GITHUB_TOKEN"; return 0; fi
  if [ -n "${GH_TOKEN:-}" ];     then printf '%s' "$GH_TOKEN";     return 0; fi
  security find-generic-password -a "${USER}" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true
}

echo "→ patch:  $PATCH ($(wc -l <"$PATCH" | tr -d ' ') lines)"
git -C "$REPO_ROOT" fetch -q origin main
# temp branch first; the real name is derived from the trailers after apply
git -C "$REPO_ROOT" worktree add -q -b "tmp-deposit-$$" "$WT" origin/main
CREATED_BRANCH="tmp-deposit-$$"
git -C "$WT" am --3way "$PATCH"

# --- read the durable markers off the applied commit -------------------------
AUTHOR_EMAIL="$(git -C "$WT" log -1 --format='%ae')"
trailer() { git -C "$WT" log -1 --format='%(trailers:key='"$1"',valueonly)' | head -n1 | tr -d '\r'; }
INCIDENT_ID="$(trailer Incident-Id)"
INCIDENT_CLASS="$(trailer Incident-Class)"
CORPUS_STORE="$(trailer Corpus-Store)"

# --- guard: this MUST be a signed agent deposit, not stray build work --------
[ "$AUTHOR_EMAIL" = "$AGENT_AUTHOR_EMAIL" ] || {
  echo "✗ refusing: commit author is <$AUTHOR_EMAIL>, not the agent identity <$AGENT_AUTHOR_EMAIL>." >&2
  echo "  A corpus deposit must be authored by incident-responder in the sandbox (ADR-0015)." >&2; exit 4; }
[ -n "$INCIDENT_ID" ] || { echo "✗ refusing: no Incident-Id trailer on the candidate commit (ADR-0015)." >&2; exit 4; }

BRANCH="incident/${INCIDENT_ID}"
TITLE="Corpus deposit — ${INCIDENT_CLASS:-unclassified} (incident ${INCIDENT_ID})"
git -C "$WT" branch -m "$BRANCH"
CREATED_BRANCH="$BRANCH"

echo "✓ signed deposit: author <$AUTHOR_EMAIL>, incident ${INCIDENT_ID}, class ${INCIDENT_CLASS:-?}, store ${CORPUS_STORE:-?}"
echo "✓ branch: $BRANCH   base: origin/main   (isolated worktree $WT; main checkout untouched)"
git -C "$WT" log --oneline origin/main..HEAD | sed 's/^/    /'
git -C "$WT" diff --stat origin/main..HEAD | sed 's/^/    /'

# PR body → a temp file (not a $(cat <<EOF) — bash 3.2 mis-parses a here-doc
# inside command substitution; a here-doc redirected to a file is 3.2-safe).
cat > "$BODY_FILE" <<EOF
Produced by the **incident-responder** agent in a Daytona sandbox; the patch was
applied on the host and this PR opened via \`tools/patch-to-pr.sh\` (ADR-0009).
The scoped push token stays on the host; the sandbox never authenticates outward.

The merge of this PR is the human gate that admits the entry and mints its id
(Art. 2 / ADR-0007). **Admit with a merge commit, not a squash** — a squash
collapses the candidate commit author and \`Incident-*\` trailers, the durable
markers this deposit is signed with (ADR-0015).

Incident-Id: ${INCIDENT_ID}
Incident-Class: ${INCIDENT_CLASS}
Corpus-Store: ${CORPUS_STORE}
EOF

if [ "$PUSH" = "--push" ]; then
  TOKEN="$(resolve_token)"
  [ -n "$TOKEN" ] || { echo "✗ --push given but no token in env or Keychain (service '$KEYCHAIN_SERVICE')" >&2; exit 3; }
  echo "→ ensuring '$LABEL' label exists, pushing $BRANCH, opening PR (human-authorized)…"
  GH_TOKEN="$TOKEN" gh label create "$LABEL" --repo slavazin/ember \
    --color 8A63D2 --description "Agent-authored incident-responder corpus deposit (ADR-0015)" 2>/dev/null || true
  git -C "$WT" -c "http.https://github.com/.extraheader=AUTHORIZATION: bearer $TOKEN" push -q origin "$BRANCH"
  GH_TOKEN="$TOKEN" gh pr create --repo slavazin/ember --head "$BRANCH" --base main \
    --label "$LABEL" --title "$TITLE" --body-file "$BODY_FILE"
else
  echo ""
  echo "DRY-RUN (no --push). Would run:"
  echo "    gh label create $LABEL … (idempotent)"
  echo "    git push origin $BRANCH"
  echo "    gh pr create --repo slavazin/ember --head $BRANCH --base main --label $LABEL --title \"$TITLE\""
  echo "The human merge (a merge commit, not a squash) is the only write that admits the entry (Art. 2 / ADR-0015)."
fi
