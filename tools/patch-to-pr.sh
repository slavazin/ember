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

# Resolve the patch to an absolute path up front: `git -C "$WT" am` runs from the
# temp worktree, so a relative path (e.g. `tools/patch-to-pr.sh candidate.patch`)
# would resolve against the wrong directory there.
[ -f "$PATCH" ] || { echo "✗ patch file not found: $PATCH" >&2; exit 2; }
PATCH="$(cd "$(dirname "$PATCH")" && pwd)/$(basename "$PATCH")"

# Repo root is derived from this script's own location (tools/…), so the helper
# is not tied to any one machine's checkout path.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel)"
AGENT_AUTHOR_NAME="incident-responder"
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

# --- guard: EVERY applied commit must be a complete signed agent deposit ------
# `git am` applies the whole mbox, so a multi-commit series could smuggle an
# unmarked commit behind a marked final one — validate all of origin/main..HEAD,
# not just the tip, and require the full ADR-0015 marker (author name+email plus
# the four Incident-*/Deposited-By trailers), all sharing one Incident-Id.
trailer_of() { git -C "$WT" log -1 --format='%(trailers:key='"$2"',valueonly)' "$1" | head -n1 | tr -d '\r'; }
refuse() { echo "✗ refusing ($1): $2 (ADR-0015)." >&2; exit 4; }

COMMITS="$(git -C "$WT" rev-list --reverse origin/main..HEAD)"
[ -n "$COMMITS" ] || refuse "empty" "the patch applied no commits over origin/main"
INCIDENT_ID=""
while IFS= read -r c; do
  [ -n "$c" ] || continue
  a_name="$(git -C "$WT" log -1 --format='%an' "$c")"
  a_email="$(git -C "$WT" log -1 --format='%ae' "$c")"
  if [ "$a_email" != "$AGENT_AUTHOR_EMAIL" ] || [ "$a_name" != "$AGENT_AUTHOR_NAME" ]; then
    refuse "$c" "author is <$a_name $a_email>, not the agent identity <$AGENT_AUTHOR_NAME $AGENT_AUTHOR_EMAIL>"
  fi
  id="$(trailer_of "$c" Incident-Id)"
  cls="$(trailer_of "$c" Incident-Class)"
  store="$(trailer_of "$c" Corpus-Store)"
  dep="$(trailer_of "$c" Deposited-By)"
  if [ -z "$id" ] || [ -z "$cls" ] || [ -z "$store" ] || [ -z "$dep" ]; then
    refuse "$c" "incomplete marker (need Incident-Id, Incident-Class, Corpus-Store, Deposited-By)"
  fi
  if [ -z "$INCIDENT_ID" ]; then INCIDENT_ID="$id"
  elif [ "$id" != "$INCIDENT_ID" ]; then refuse "$c" "mixes incident ids ($id vs $INCIDENT_ID) in one deposit"
  fi
done <<< "$COMMITS"

AUTHOR_EMAIL="$AGENT_AUTHOR_EMAIL"
INCIDENT_CLASS="$(trailer_of HEAD Incident-Class)"
CORPUS_STORE="$(trailer_of HEAD Corpus-Store)"

# Unique per candidate, stable per content: multiple candidates per incident are
# supported, so suffix the incident id rather than colliding on incident/<id>. Use
# the resulting TREE sha, not the commit sha — the commit sha carries a per-run
# committer timestamp, so re-running the same patch would open a duplicate branch;
# the tree is deterministic for the same diff on the same base (idempotent re-runs).
CONTENT_ID="$(git -C "$WT" rev-parse --short "HEAD^{tree}")"
BRANCH="incident/${INCIDENT_ID}-${CONTENT_ID}"
TITLE="Corpus deposit — ${INCIDENT_CLASS} (incident ${INCIDENT_ID})"
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
  # Inject the auth header via GIT_CONFIG_* env vars, not `git -c …$TOKEN` — a
  # command-line arg is visible to `ps`/process inspection; the env value is not.
  GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
  GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer $TOKEN" \
    git -C "$WT" push -q origin "$BRANCH"
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
