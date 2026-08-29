#!/usr/bin/env bash
# Score a diagnosis report for the jobs-queue consumer-wedge incident (poison
# message). Same class and decoy as poison-message-a, so the gates match: a
# state-aware diagnosis reads the head-of-queue state; a naive one chases
# capacity.
#
# PRESENCE, NOT CORRECTNESS. This is a floor, not a judge. It counts declared
# steps and checks that the report mentions the things a state-aware diagnosis
# mentions. It verifies nothing about whether the diagnosis is true. The residue
# block below and the scenario README state exactly what it does not check.
#
# Usage: grade.sh [REPORT.md] [--max-steps N]
#   REPORT.md    diagnosis report to score (default: fixtures/diagnosis-good.md)
#   --max-steps  optional threshold; prints PASS/OVER against the step count
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

REPORT=""
MAX_STEPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --max-steps)
      if [ $# -lt 2 ] || ! printf '%s' "${2:-}" | grep -qE '^[0-9]+$'; then
        echo "grade: --max-steps requires a nonnegative integer" >&2
        exit 2
      fi
      MAX_STEPS="$2"; shift 2 ;;
    *)           REPORT="$1"; shift ;;
  esac
done
REPORT="${REPORT:-$SCRIPT_DIR/fixtures/diagnosis-good.md}"

if [ ! -f "$REPORT" ]; then
  echo "grade: report not found: $REPORT" >&2
  exit 2
fi

# ── Step count ────────────────────────────────────────────────────────────
FM_STEPS=$(awk '
  NR==1 && $0=="---" { infm=1; next }
  infm && $0=="---"  { exit }
  infm && $0 ~ /^steps:[[:space:]]*[0-9]+/ { gsub(/[^0-9]/,""); print; exit }
' "$REPORT")

LIST_STEPS=$(awk '
  /^```/ { infence = !infence; next }
  !infence && $0 ~ /^[[:space:]]*[0-9]+\.[[:space:]]/ { n++ }
  END { print n + 0 }
' "$REPORT")

if [ -n "$FM_STEPS" ]; then
  STEPS="$FM_STEPS"; STEP_METHOD="frontmatter (steps:)"
else
  STEPS="$LIST_STEPS"; STEP_METHOD="ordered-list scan (outside code fences)"
fi

# ── Gate: bad-state section (the required gate) ────────────────────────────
# A heading naming the queue/message/state/row, with a poison/head-of-line token
# inside that section.
STATE_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /^#+[[:space:]].*(queue|message|state|backlog|head|record|row)/ { insec = 1; heading = $0; next }
  insec && l ~ /^#+[[:space:]]/ { insec = 0 }
  insec && l ~ /poison|malformed|invalid|deserial|validation|does not (advance|clear)|not advancing|head.?of.?line|head of line|stuck|re-?deliver|quarantin|dead.?letter|dlq|bad (message|record|row)/ {
    print heading " >> " $0; exit
  }
' "$REPORT")
STATE_GATE=$([ -n "$STATE_MATCH" ] && echo PASS || echo FAIL)

# ── Gate: capacity ruled out ───────────────────────────────────────────────
CAP_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /(worker|postgres|database| db |broker|capacity|cpu|scal|thread)/ &&
  l ~ /(healthy|idle|(is|are|stays?|kept|remains?) low|not the|ruled out|excluded|does not (help|drain)|won'\''t help|no (more|help))/ {
    print; exit
  }
' "$REPORT")
CAP_GATE=$([ -n "$CAP_MATCH" ] && echo PASS || echo FAIL)

# ── Gate: latch-walk attestation ───────────────────────────────────────────
LATCH_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /^latch-walk:/ || l ~ /^#+[[:space:]]+latch[ -]?walk/ { print; exit }
' "$REPORT")
LATCH_GATE=$([ -n "$LATCH_MATCH" ] && echo PASS || echo FAIL)

# ── Report ─────────────────────────────────────────────────────────────────
echo "grade: report=$REPORT"
echo "grade: steps=$STEPS  (method: $STEP_METHOD)"
if [ -n "$MAX_STEPS" ]; then
  if [ "$STEPS" -le "$MAX_STEPS" ]; then echo "grade: step-threshold=PASS (<= $MAX_STEPS)";
  else echo "grade: step-threshold=OVER (> $MAX_STEPS)"; fi
fi
echo "grade: gate bad-state           = $STATE_GATE ${STATE_MATCH:+-> $STATE_MATCH}"
echo "grade: gate capacity-ruled-out  = $CAP_GATE ${CAP_MATCH:+-> $CAP_MATCH}"
echo "grade: gate latch-walk          = $LATCH_GATE ${LATCH_MATCH:+-> $LATCH_MATCH}"
echo "SCORE steps=$STEPS bad_state=$STATE_GATE capacity_ruled_out=$CAP_GATE latch_walk=$LATCH_GATE"

echo "grade: --- residue (NOT checked) ---"
echo "grade:  * that any number in the report is correct"
echo "grade:  * that the diagnosis is right or the named quarantine would work"
echo "grade:  * that a matched section carries meaningful content (a heading"
echo "grade:    with the right words passes — presence, not correctness)"
echo "grade:  * that the step count reflects real work rather than padding"

# Exit 0 when the required gate (bad-state) passes. The step count is the demo
# metric and is reported, never a pass/fail on its own.
[ "$STATE_GATE" = "PASS" ]
