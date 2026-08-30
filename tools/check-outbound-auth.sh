#!/usr/bin/env bash
# Outbound-auth guard for the host helper scripts — mechanizes blindspot BS-0051
# (credential-not-propagated-to-child).
#
# patch-to-pr.sh holds the push token as a NON-EXPORTED shell var ($TOKEN) and hands
# it to each outward-authenticating command through a command-local env prefix
# (`GH_TOKEN="$TOKEN" gh …`). A child added later — a subshell, an `npm run`, a spawned
# tool — inherits the environment WITHOUT it and authenticates with nothing. It reads as
# working on any host that happens to carry an ambient GH_TOKEN and fails only on the
# Keychain-fallback path, so the author's own manual check never sees it. It has already
# recurred across two PRs (#21, then the gate subshell in #28).
#
# The preempt: "hand every newly-added authenticating command the secret the same way
# the script's existing calls receive it." This guard turns that into a check: every
# command-position `gh` or `npm run` invocation in the scanned scripts must carry a
# `GH_TOKEN=` assignment on the same command. A new un-prefixed call fails CI loudly
# instead of silently on one unlucky host.
#
# Scope: `gh` and `npm run` — the two child forms this helper actually uses to reach
# outward. git-over-https auth rides the GIT_CONFIG_* extraheader env on the `git`
# calls, a separate mechanism that has not recurred and is not scanned here.
set -euo pipefail

# Default to the host scripts this guard exists for; overridable so it can be pointed at
# a fixture in its own test. NOT self-scanning — this file names `gh`/`GH_TOKEN` in its
# patterns and prose, the self-match pitfall (BS-0004/BS-0022) a fixed list avoids.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=("$here/patch-to-pr.sh" "$here/patch-to-pr-lib.sh")
fi

rc=0
for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "✗ not a file: $f" >&2; exit 2; }
  # awk finds every command-position `gh`/`npm run` invocation whose command carries no
  # GH_TOKEN= assignment. It does NOT blank quoted spans — a real call can sit inside a
  # command substitution (`X="$(gh pr view …)"`), and blanking the quotes would hide it.
  # Instead the two non-invocation cases are dropped directly: whole-line comments (the
  # header documents gh/GH_TOKEN in prose), and echo/printf lines (the dry-run block
  # PRINTS `gh pr create …` as text — the echoed-doc self-match, BS-0004/BS-0022). A
  # command substitution opens with `(` or a backtick, both in the command-boundary class,
  # so `$(gh …` and `` `gh …`` are still seen as invocations.
  awk -v file="$f" '
    { line = $0; probe = line; sub(/^[ \t]+/, "", probe) }
    probe ~ /^#/            { next }   # whole-line comment
    probe ~ /^(echo|printf)([ \t]|$)/ { next }   # prints text, not a command
    {
      code = line; sub(/[ \t]+#.*$/, "", code)   # drop a trailing inline comment
      is_gh  = (code ~ /(^|[ \t;&|(){}!`])gh([ \t]|$)/)
      is_npm = (code ~ /(^|[ \t;&|(){}!`])npm[ \t]+run([ \t]|$)/)
      if ((is_gh || is_npm) && code !~ /GH_TOKEN=/) {
        printf("%s:%d: outward-auth command without a GH_TOKEN= prefix (BS-0051):\n    %s\n", file, NR, line)
        bad++
      }
    }
    END { if (bad) exit 1 }
  ' "$f" || rc=1
done

if [ "$rc" -eq 0 ]; then
  echo "✓ outbound-auth: every gh / npm run invocation carries the token prefix"
else
  echo "✗ outbound-auth: an outward-authenticating command is missing its GH_TOKEN= prefix (BS-0051)" >&2
fi
exit "$rc"
