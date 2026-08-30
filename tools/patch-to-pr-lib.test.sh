#!/usr/bin/env bash
# Parse-fidelity battery for read_fm (tools/patch-to-pr-lib.sh).
#
# read_fm is a hand-rolled awk scalar reader — the one class in this project that
# keeps re-earning itself, three times in this single function inside one PR:
#   BS-0055  a CRLF `---\r` delimiter was compared against the raw line → the scan
#            never entered the block and a valid record read as "no incident".
#   BS-0059  an unquoted trailing `# comment` was left attached to the value → a
#            valid commented id was refused by the caller's safe-id check.
#   BS-0061  a `#` inside a *quoted* scalar was stripped as a comment → a different,
#            valid-looking id was forged and committed under the wrong path.
# The preempt (blindspots.md, parse-fidelity): "enumerate every valid spelling the
# real parser accepts and test each." A shell/awk host can't reach for a real YAML
# parser, so this battery IS the guard — every spelling that has bitten, plus the
# neighbours it must still get right, pinned so the next edit can't quietly regress one.
#
# No `set -e`: every case runs so one failure never hides the rest; the exit code is
# the count of failures.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=tools/patch-to-pr-lib.sh
. "$here/patch-to-pr-lib.sh"

fails=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# check <name> <key> <expected> — the frontmatter file content arrives on stdin, so a
# test can spell CRLF and other bytes with printf without a heredoc mangling them.
check() {
  name="$1"; key="$2"; expected="$3"
  f="$tmp/case"
  cat > "$f"
  got="$(read_fm "$f" "$key")"
  if [ "$got" = "$expected" ]; then
    printf '  ok   %s\n' "$name"
  else
    printf '  FAIL %s\n         key=%s\n         expected=[%s]\n         got=     [%s]\n' \
      "$name" "$key" "$expected" "$got"
    fails=$((fails + 1))
  fi
}

printf 'read_fm parse-fidelity battery\n'

# --- the happy path and its ordinary neighbours -------------------------------------
printf -- '---\nincident: INC-0001\n---\n' \
  | check "plain unquoted scalar" incident "INC-0001"

printf -- '---\nincident:    INC-0002\n---\n' \
  | check "extra spaces after the colon are trimmed" incident "INC-0002"

printf -- '---\nincident:\tINC-0003\n---\n' \
  | check "a tab after the colon is trimmed" incident "INC-0003"

printf -- '---\nincident: INC-0004   \n---\n' \
  | check "trailing whitespace is stripped" incident "INC-0004"

# key prefix must be exact: `incident` must not read `incident-class` (^key:)
printf -- '---\nincident-class: cache\nincident: INC-0005\n---\n' \
  | check "^key: does not match a longer key" incident "INC-0005"

printf -- '---\nincident-class: cache\n---\n' \
  | check "a longer-keyed line alone yields nothing" incident ""

# --- BS-0055 · CRLF: the delimiter check must see de-CR'd text -----------------------
printf -- '---\r\nincident: INC-0055\r\n---\r\n' \
  | check "BS-0055 CRLF delimiter + value parse" incident "INC-0055"

printf -- '---\r\nincident-class: cache\r\nincident: INC-0056\r\n---\r\n' \
  | check "BS-0055 CRLF with a preceding longer key" incident "INC-0056"

# --- BS-0059 · an unquoted inline comment is dropped --------------------------------
printf -- '---\nincident: INC-0059 # a note\n---\n' \
  | check "BS-0059 unquoted inline comment dropped" incident "INC-0059"

printf -- '---\nincident: INC-0159\t# tab-led comment\n---\n' \
  | check "BS-0059 tab-led inline comment dropped" incident "INC-0159"

# a '#' with no leading whitespace is NOT a comment — it is part of the bare scalar
printf -- '---\nincident: INC#0259\n---\n' \
  | check "a '#' without leading space stays in the value" incident "INC#0259"

# --- BS-0061 · a '#' INSIDE quotes is data, returned verbatim ------------------------
printf -- '---\nincident: "INC-0061 # x"\n---\n' \
  | check "BS-0061 double-quoted '#' survives verbatim" incident "INC-0061 # x"

printf -- "---\nincident: 'INC-0161 # y'\n---\n" \
  | check "BS-0061 single-quoted '#' survives verbatim" incident "INC-0161 # y"

# a real comment AFTER the closing quote is still ignored; content is between the quotes
printf -- '---\nincident: "INC-0261" # tail\n---\n' \
  | check "content is between quotes; post-quote comment ignored" incident "INC-0261"

# an unterminated quote is left as-is (the caller's safe-id check then rejects it)
printf -- '---\nincident: "INC-0361\n---\n' \
  | check "an unterminated quote is left intact for the caller to reject" incident '"INC-0361'

# --- absence and malformed-frontmatter cases return empty ---------------------------
printf -- '---\nother: value\n---\n' \
  | check "an absent key yields nothing" incident ""

printf -- 'not-frontmatter\nincident: INC-0999\n---\n' \
  | check "no leading '---' means no frontmatter" incident ""

printf -- 'incident: INC-0999\n' \
  | check "a bare body with no fences yields nothing" incident ""

# a second block after the frontmatter must not be read (scan stops at the close fence)
printf -- '---\nincident: INC-0007\n---\nincident: INC-DECOY\n' \
  | check "only the FIRST frontmatter block is read" incident "INC-0007"

printf '\n'
if [ "$fails" -eq 0 ]; then
  printf 'read_fm: all cases passed\n'
  exit 0
fi
printf 'read_fm: %d case(s) FAILED\n' "$fails"
exit 1
