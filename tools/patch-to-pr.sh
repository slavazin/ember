#!/usr/bin/env bash
# Corpus-deposit helper (U1 fallback, ADR-0009 + ADR-0015 + ADR-0019): turn a
# sandbox-produced patch and/or close-out record into a SIGNED, LABELLED
# corpus-deposit PR — locally, with the scoped push token held HERE (never in the
# sandbox). Human-gated: pushes/opens a PR only with --push; otherwise it dry-runs
# (creates the branch in an isolated worktree, applies the patch, and prints exactly
# what it would push).
#
# The candidate's durable marker (author = incident-responder, Incident-* trailers)
# is set in the SANDBOX and rides the patch; `git am` preserves it. This helper reads
# those trailers back off the applied commit and DERIVES the branch, title, label,
# and body from them — the surface markers restate the commit, they never invent it.
#
# The CLOSE-OUT RECORD (ADR-0019) carries the close-out's own content — the
# consulted-entry dispositions, the report metadata (steps/disposition/forecast_hit),
# and the `latch-walk:` attestation — that `git format-patch -1` leaves behind in the
# branch work product. It is retrieved from the sandbox branch over the same ADR-0009
# file-download channel as the patch and handed to this helper with `--close-out`. The
# helper commits it under the reserved incident-responder author (host = committer) and
# folds it into the PR body, so the record rides the merge into the one shared history
# the next boot reads. A close-out with NO candidate patch (a quiet close) is filed on
# its own: the dispositions and the closing attestation are a durable record without a
# deposit (see skills/close/SKILL.md, "The close-out is the pull request").
#
# Usage:
#   patch-to-pr.sh <patch-file> [--close-out <record>] [--push]   # candidate deposit
#   patch-to-pr.sh --close-out <record> [--push]                  # quiet close, no candidate
# Token resolution for --push (never echoed), first hit wins:
#   1. $GITHUB_TOKEN / $GH_TOKEN in the environment
#   2. macOS Keychain generic password  service=ember-github-push-token account=$USER
# The token never enters the repo, the sandbox, or the command line.
set -euo pipefail

# --- argument parsing: a positional patch file, an optional --close-out record, and
# an optional --push, in any order. At least one of patch / close-out is required.
PATCH=""
CLOSEOUT=""
PUSH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH="--push"; shift ;;
    --close-out)
      shift
      [ $# -gt 0 ] || { echo "✗ --close-out requires a file argument" >&2; exit 2; }
      CLOSEOUT="$1"; shift ;;
    --close-out=*) CLOSEOUT="${1#--close-out=}"; shift ;;
    -*) echo "✗ unknown option: $1" >&2; exit 2 ;;
    *)
      if [ -z "$PATCH" ]; then PATCH="$1"; shift
      else echo "✗ unexpected extra argument: $1" >&2; exit 2; fi ;;
  esac
done
if [ -z "$PATCH" ] && [ -z "$CLOSEOUT" ]; then
  echo "✗ need a patch file and/or --close-out <record>" >&2; exit 2
fi

# Resolve each input to an absolute path up front: `git -C "$WT" …` runs from the temp
# worktree, so a relative path (e.g. `tools/patch-to-pr.sh candidate.patch`) would
# resolve against the wrong directory there.
if [ -n "$PATCH" ]; then
  [ -f "$PATCH" ] || { echo "✗ patch file not found: $PATCH" >&2; exit 2; }
  PATCH="$(cd "$(dirname "$PATCH")" && pwd)/$(basename "$PATCH")"
fi
if [ -n "$CLOSEOUT" ]; then
  [ -f "$CLOSEOUT" ] || { echo "✗ close-out record not found: $CLOSEOUT" >&2; exit 2; }
  CLOSEOUT="$(cd "$(dirname "$CLOSEOUT")" && pwd)/$(basename "$CLOSEOUT")"
fi

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

# read_fm (YAML frontmatter scalar reader) lives in a sourceable library so its
# parse-fidelity battery (tools/patch-to-pr-lib.test.sh) can exercise it in isolation —
# the class has re-earned itself three times in this one function (BS-0055/0059/0061).
# shellcheck source=tools/patch-to-pr-lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/patch-to-pr-lib.sh"

trailer_of() { git -C "$WT" log -1 --format='%(trailers:key='"$2"',valueonly)' "$1" | head -n1 | tr -d '\r'; }
reject() { echo "✗ $1" >&2; exit 4; }

if [ -n "$PATCH" ]; then
  echo "→ patch:  $PATCH ($(wc -l <"$PATCH" | tr -d ' ') lines)"
fi
if [ -n "$CLOSEOUT" ]; then
  echo "→ close-out record:  $CLOSEOUT ($(wc -l <"$CLOSEOUT" | tr -d ' ') lines)"
fi
git -C "$REPO_ROOT" fetch -q origin main
# temp branch first; the real name is derived from the trailers/record after apply
git -C "$REPO_ROOT" worktree add -q -b "tmp-deposit-$$" "$WT" origin/main
CREATED_BRANCH="tmp-deposit-$$"

INCIDENT_ID=""
INCIDENT_CLASS=""
CORPUS_STORE=""
MODE=""

# --- candidate deposit: apply the patch and validate its ADR-0015 markers ----------
if [ -n "$PATCH" ]; then
  MODE="candidate"
  # Feed the mbox on stdin: the `< "$PATCH"` redirection is resolved by THIS shell
  # (the caller's cwd), so the patch path never has to be interpreted from inside the
  # `git -C "$WT"` worktree. ($PATCH is also absolutised above — belt and suspenders.)
  git -C "$WT" am --3way < "$PATCH"

  # guard: EVERY applied commit must be a complete signed agent deposit.
  # `git am` applies the whole mbox, so a multi-commit series could smuggle an
  # unmarked commit behind a marked final one — validate all of origin/main..HEAD,
  # not just the tip, and require the full ADR-0015 marker (author name+email plus
  # the four Incident-*/Deposited-By trailers), all sharing one Incident-Id. The
  # close-out commit this helper adds below is host-built, not from the untrusted
  # patch, so it is admitted on its own terms (ADR-0019) and is not subject to this
  # anti-smuggling guard — which is why the guard runs here, before it is added.
  COMMITS="$(git -C "$WT" rev-list --reverse origin/main..HEAD)"
  [ -n "$COMMITS" ] || reject "the patch applied no commits over origin/main (ADR-0015)."
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    a_name="$(git -C "$WT" log -1 --format='%an' "$c")"
    a_email="$(git -C "$WT" log -1 --format='%ae' "$c")"
    if [ "$a_email" != "$AGENT_AUTHOR_EMAIL" ] || [ "$a_name" != "$AGENT_AUTHOR_NAME" ]; then
      reject "refusing ($c): author is <$a_name $a_email>, not the agent identity <$AGENT_AUTHOR_NAME $AGENT_AUTHOR_EMAIL> (ADR-0015)."
    fi
    id="$(trailer_of "$c" Incident-Id)"
    cls="$(trailer_of "$c" Incident-Class)"
    store="$(trailer_of "$c" Corpus-Store)"
    dep="$(trailer_of "$c" Deposited-By)"
    if [ -z "$id" ] || [ -z "$cls" ] || [ -z "$store" ] || [ -z "$dep" ]; then
      reject "refusing ($c): incomplete marker (need Incident-Id, Incident-Class, Corpus-Store, Deposited-By) (ADR-0015)."
    fi
    if [ -z "$INCIDENT_ID" ]; then INCIDENT_ID="$id"
    elif [ "$id" != "$INCIDENT_ID" ]; then reject "refusing ($c): mixes incident ids ($id vs $INCIDENT_ID) in one deposit (ADR-0015)."
    fi
  done <<< "$COMMITS"

  # HEAD is still the candidate tip here — its class and store are authoritative.
  INCIDENT_CLASS="$(trailer_of HEAD Incident-Class)"
  CORPUS_STORE="$(trailer_of HEAD Corpus-Store)"
fi

# --- close-out record: commit it under the reserved author and fold into the body --
# The record's content is sandbox-produced (branch work product); the host transcribes
# its frontmatter into the commit markers and restates the incident-responder author.
# Deliberately NO Incident-Class trailer: a close-out is grouped by the work-shape it
# declares, not the class-grouping trailer (skills/consolidate/SKILL.md), and adding one
# would double-count the incident in the class read-out where a candidate already carries it.
if [ -n "$CLOSEOUT" ]; then
  rec_incident="$(read_fm "$CLOSEOUT" incident)"
  rec_incident="${rec_incident%\"}"; rec_incident="${rec_incident#\"}"
  rec_incident="${rec_incident%\'}"; rec_incident="${rec_incident#\'}"
  [ -n "$rec_incident" ] || reject "close-out record has no 'incident:' frontmatter field — cannot mark the record (ADR-0019)."
  case "$rec_incident" in
    *[!A-Za-z0-9._-]* | .. | . )
      reject "close-out 'incident:' ($rec_incident) is not a safe id ([A-Za-z0-9._-], no path parts) (ADR-0019)." ;;
  esac

  if [ -n "$PATCH" ]; then
    # candidate + close-out: the record must belong to the deposit it rides.
    [ "$rec_incident" = "$INCIDENT_ID" ] || reject "close-out incident ($rec_incident) ≠ candidate incident ($INCIDENT_ID) — record does not match the deposit (ADR-0019)."
  else
    # Quiet close: the record is the whole deposit. The incident id names the branch and
    # the record path; a quiet close is grouped by the work-shape it declares, not a class
    # trailer (skills/consolidate/SKILL.md), so no class is read or carried here.
    MODE="quiet"
    INCIDENT_ID="$rec_incident"
  fi

  REC_REL="tenant-incident/incidents/${INCIDENT_ID}/close-out.md"
  REC_DEST="$WT/$REC_REL"
  mkdir -p "$(dirname "$REC_DEST")"
  tr -d '\r' < "$CLOSEOUT" > "$REC_DEST"
  git -C "$WT" add "$REC_REL"

  if [ "$MODE" = "candidate" ]; then
    co_summary="Incident close-out record — incident ${INCIDENT_ID}"
  else
    co_summary="Incident close-out — incident ${INCIDENT_ID}"
  fi
  # Trailers written into the message footer (git parses them the same as --trailer);
  # author = the reserved agent identity, committer = the host applying it (ADR-0015 split).
  git -C "$WT" commit -q \
    --author="$AGENT_AUTHOR_NAME <$AGENT_AUTHOR_EMAIL>" \
    -m "$co_summary" \
    -m "Incident-Id: ${INCIDENT_ID}
Deposited-By: incident-responder
Close-Record: true"
fi

# --- derive the surface markers and file --------------------------------------------
COMMITS_ALL="$(git -C "$WT" rev-list origin/main..HEAD)"
[ -n "$COMMITS_ALL" ] || reject "no commits over origin/main (need a patch and/or a close-out record)."

# Unique per candidate, stable per content: multiple candidates per incident are
# supported, so suffix the incident id rather than colliding on incident/<id>. Use
# the resulting TREE sha, not the commit sha — the commit sha carries a per-run
# committer timestamp, so re-running the same patch would open a duplicate branch;
# the tree is deterministic for the same diff on the same base (idempotent re-runs).
CONTENT_ID="$(git -C "$WT" rev-parse --short "HEAD^{tree}")"
BRANCH="incident/${INCIDENT_ID}-${CONTENT_ID}"
if [ "$MODE" = "quiet" ]; then
  TITLE="Incident close-out — incident ${INCIDENT_ID} (no candidate)"
else
  TITLE="Corpus deposit — ${INCIDENT_CLASS} (incident ${INCIDENT_ID})"
fi
git -C "$WT" branch -m "$BRANCH"
CREATED_BRANCH="$BRANCH"

if [ "$MODE" = "quiet" ]; then
  echo "✓ quiet close-out: author <$AGENT_AUTHOR_EMAIL>, incident ${INCIDENT_ID}, no candidate deposit"
else
  echo "✓ signed deposit: author <$AGENT_AUTHOR_EMAIL>, incident ${INCIDENT_ID}, class ${INCIDENT_CLASS:-?}, store ${CORPUS_STORE:-?}"
  if [ -n "$CLOSEOUT" ]; then
    echo "✓ close-out record committed alongside the candidate: tenant-incident/incidents/${INCIDENT_ID}/close-out.md"
  fi
fi
echo "✓ branch: $BRANCH   base: origin/main   (isolated worktree $WT; main checkout untouched)"
git -C "$WT" log --oneline origin/main..HEAD | sed 's/^/    /'
git -C "$WT" diff --stat origin/main..HEAD | sed 's/^/    /'

# PR body → a temp file (not a $(cat <<EOF) — bash 3.2 mis-parses a here-doc
# inside command substitution; a here-doc redirected to a file is 3.2-safe).
if [ "$MODE" = "quiet" ]; then
  cat > "$BODY_FILE" <<EOF
Produced by the **incident-responder** agent in a Daytona sandbox; the close-out record
was retrieved on the host and this PR opened via \`tools/patch-to-pr.sh\` (ADR-0009 +
ADR-0019). The scoped push token stays on the host; the sandbox never authenticates
outward.

This is a **quiet close** — the session drafted no candidate, so this PR carries the
close-out's own content (dispositions, report metadata, and the \`latch-walk:\`
attestation) and nothing more. A close-out is a durable record on its own
(skills/close/SKILL.md); the slow loop reads it across the fast-loop PRs
(skills/consolidate/SKILL.md), keyed by the work-shape it declares — a quiet close
carries no \`Incident-Class\` trailer.

The merge of this PR is the human gate (Art. 2 / ADR-0007). **Admit with a merge
commit, not a squash** — a squash collapses the close-out commit's incident-responder
author and \`Incident-*\`/\`Close-Record\` trailers, the durable markers this record is
signed with (ADR-0015 / ADR-0019).

Incident-Id: ${INCIDENT_ID}
Close-Record: true

## Close-out record
EOF
  tr -d '\r' < "$CLOSEOUT" >> "$BODY_FILE"
else
  cat > "$BODY_FILE" <<EOF
Produced by the **incident-responder** agent in a Daytona sandbox; the patch was
applied on the host and this PR opened via \`tools/patch-to-pr.sh\` (ADR-0009).
The scoped push token stays on the host; the sandbox never authenticates outward.

The merge of this PR is the human gate that admits the entry (Art. 2 / ADR-0007);
the incident id is already fixed in the commit's \`Incident-Id\` trailer, not minted
by the merge. **Admit with a merge commit, not a squash** — a squash collapses the
candidate commit author and \`Incident-*\` trailers, the durable markers this deposit
is signed with (ADR-0015).

Incident-Id: ${INCIDENT_ID}
Incident-Class: ${INCIDENT_CLASS}
Corpus-Store: ${CORPUS_STORE}
EOF
  if [ -n "$CLOSEOUT" ]; then
    # Fold the close-out record's own content into the body so the dispositions,
    # report metadata, and latch-walk attestation reach the PR alongside the deposit
    # (ADR-0019); the record also rides the branch as a committed file.
    {
      echo ""
      echo "## Close-out record"
    } >> "$BODY_FILE"
    tr -d '\r' < "$CLOSEOUT" >> "$BODY_FILE"
  fi
fi

if [ "$PUSH" = "--push" ]; then
  TOKEN="$(resolve_token)"
  [ -n "$TOKEN" ] || { echo "✗ --push given but no token in env or Keychain (service '$KEYCHAIN_SERVICE')" >&2; exit 3; }
  echo "→ ensuring '$LABEL' label exists, pushing $BRANCH, opening PR (human-authorized)…"
  GH_TOKEN="$TOKEN" gh label create "$LABEL" --repo slavazin/ember \
    --color 8A63D2 --description "Agent-authored incident-responder corpus deposit (ADR-0015)" 2>/dev/null || true
  # The auth header rides GIT_CONFIG_* env vars, not `git -c …$TOKEN` — a command-line
  # arg is visible to `ps`/process inspection; the env value is not. The branch name is
  # content-addressed (incident/<id>-<tree>), and a re-push of a fresh commit with a new
  # per-run timestamp would otherwise fail as a non-fast-forward and strand the required
  # PR. So make the push idempotent — but by verifying the CONTENT, not just the name: a
  # name match alone does not prove identical content (a moved branch, or an abbreviated
  # tree-sha collision). Resolve the remote tip, compare its tree to HEAD's, skip only on
  # an exact match, and fail safely on a mismatch rather than reuse stale content.
  REMOTE_SHA="$(GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer $TOKEN" \
    git -C "$WT" ls-remote origin "refs/heads/$BRANCH" | awk 'NR==1 {print $1}')"
  if [ -n "$REMOTE_SHA" ]; then
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer $TOKEN" \
      git -C "$WT" fetch -q origin "$BRANCH"
    REMOTE_TREE="$(git -C "$WT" rev-parse "FETCH_HEAD^{tree}")"
    LOCAL_TREE="$(git -C "$WT" rev-parse "HEAD^{tree}")"
    if [ "$REMOTE_TREE" = "$LOCAL_TREE" ]; then
      echo "→ remote branch $BRANCH already carries this exact tree; skipping push (idempotent re-run)"
    else
      reject "remote branch $BRANCH exists with a DIFFERENT tree ($REMOTE_TREE vs $LOCAL_TREE) — refusing to reuse stale or unrelated content (ADR-0019)."
    fi
  else
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer $TOKEN" \
      git -C "$WT" push -q origin "$BRANCH"
  fi
  # Open a PR only if THE corpus-deposit PR is already open for this head — so a retry
  # after a push that succeeded but whose PR-open failed does not error on "a pull request
  # already exists". `gh pr list --head` filters by branch NAME only (no owner qualifier),
  # so verify identity in the query: same repository (not a fork — isCrossRepository false),
  # base main, and the corpus-deposit label. A fork PR or a mislabeled same-name PR must not
  # be mistaken for the required filing. Do NOT suppress a failed lookup: an auth/network
  # error must surface, not masquerade as "no PR" and drive a spurious create — stderr is
  # left intact and a failure exits here.
  if ! EXISTING_PR="$(GH_TOKEN="$TOKEN" gh pr list --repo slavazin/ember --head "$BRANCH" --state open \
    --json url,baseRefName,isCrossRepository,labels \
    --jq "[.[] | select(.isCrossRepository==false and .baseRefName==\"main\" and (any(.labels[]?; .name==\"$LABEL\"))) | .url] | .[0] // empty")"; then
    echo "✗ failed to query existing pull requests for $BRANCH — not filing, to avoid a duplicate (surface to human)" >&2
    exit 3
  fi
  # Resolve the PR URL from whichever path applies — the already-open filing or a fresh
  # create — so the post-close gate below can address it by number in either case.
  if [ -n "$EXISTING_PR" ]; then
    echo "→ corpus-deposit pull request already open for $BRANCH: $EXISTING_PR"
    PR_URL="$EXISTING_PR"
  else
    # If a same-name PR exists but is not the corpus-deposit filing (wrong base/label), the
    # create below fails loudly ("a pull request already exists") — an actionable error, not
    # a silent skip. Capture the new PR's URL so the post-close gate can address it by
    # number; still echo it for the operator. `gh pr create` prints the URL on stdout.
    PR_URL="$(GH_TOKEN="$TOKEN" gh pr create --repo slavazin/ember --head "$BRANCH" --base main \
      --label "$LABEL" --title "$TITLE" --body-file "$BODY_FILE")"
    echo "$PR_URL"
  fi
  PR_NUMBER="${PR_URL##*/}"

  # Post-close Qodo severity gate (ADR-0017), OFF unless QODO_GATE=on. It runs HERE on
  # the host — never in the sandbox — because it authenticates outward (the gh token and
  # the TrueForge session API), which the sandbox cannot (ADR-0009). It is advisory: the
  # PR is already open, the gate only re-reviews and may spawn a bounded remediation
  # session, and it never merges (Art. 2 & 10). A non-zero gate result does NOT undo the
  # PR and does NOT fail this helper — the deposit stands; the gate's own output is the
  # human-facing signal. With QODO_GATE unset/off this whole block is a clean no-op.
  if [ "${QODO_GATE:-}" = "on" ]; then
    case "$PR_NUMBER" in
      ''|*[!0-9]*)
        echo "⚠ QODO_GATE=on but no numeric PR number parsed from '$PR_URL' — skipping the gate; PR stands." >&2
        ;;
      *)
        echo "→ QODO_GATE=on: running the post-close Qodo severity gate on PR #$PR_NUMBER (host-side, advisory)…"
        # Run from the repo root so `npm run` resolves this repo's package.json and the
        # tool's relative path; the subshell keeps this helper's cwd unchanged. `if !`
        # captures a non-zero exit (High findings remain, or inconclusive) without
        # letting `set -e` abort — the PR must stand regardless of the verdict.
        #
        # Hand the gate the SAME resolved token these gh calls used, as an env var on the
        # child (the `ps`-safe form the rest of this script uses, never a CLI arg). TOKEN
        # is a non-exported shell var, so without this the gate's own `gh` calls would run
        # unauthenticated whenever the token came from the Keychain fallback (no ambient
        # GH_TOKEN) and stall at its first `gh pr view`. The gate reaches TrueForge over a
        # separate channel; this only auths its gh side.
        if ! ( cd "$REPO_ROOT" && GH_TOKEN="$TOKEN" npm run qodo-gate -- --pr="$PR_NUMBER" ); then
          echo "⚠ qodo-gate exited non-zero (High findings remain or inconclusive) — PR #$PR_NUMBER stands; surface to human." >&2
        fi
        ;;
    esac
  fi
else
  echo ""
  echo "DRY-RUN (no --push). Would run:"
  echo "    gh label create $LABEL … (idempotent)"
  echo "    git push origin $BRANCH"
  echo "    gh pr create --repo slavazin/ember --head $BRANCH --base main --label $LABEL --title \"$TITLE\""
  echo "The human merge (a merge commit, not a squash) is the only write that admits the entry (Art. 2 / ADR-0015)."
fi
