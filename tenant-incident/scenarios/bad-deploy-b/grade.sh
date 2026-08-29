#!/usr/bin/env bash
# Score a diagnosis report for the pricing error-rate incident (bad deploy).
#
# PRESENCE, NOT CORRECTNESS. This is a floor, not a judge. It counts declared
# steps and checks that the report mentions the things a change-aware diagnosis
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

# ── Gate: change correlation (the required gate) ───────────────────────────
# A heading naming the deploy/build/version, with a correlation token inside
# that section — the running build tied to the symptom onset or a rollback.
CHANGE_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /^#+[[:space:]].*(deploy|release|version|build|rollback|roll back|change|regress)/ { insec = 1; heading = $0; next }
  insec && l ~ /^#+[[:space:]]/ { insec = 0 }
  insec && l ~ /deploy|rolled ?back|roll ?back|revert|previous build|prior build|onset|coincide|correlat|last (good|known)|new build|2026\.09\.0/ {
    print heading " >> " $0; exit
  }
' "$REPORT")
CHANGE_GATE=$([ -n "$CHANGE_MATCH" ] && echo PASS || echo FAIL)

# ── Gate: input / data ruled out (the decoy for this surface) ──────────────
# The errors hit only some carts, which reads as bad data; this gate rewards
# naming the inputs as unchanged / handled by the prior build.
INPUT_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /(input|data|cart|payload|record|catalog|schema)/ &&
  l ~ /(unchanged|same|not the|ruled out|(are|is|were) valid|handled|previous build|prior build|did not change)/ {
    print; exit
  }
' "$REPORT")
INPUT_GATE=$([ -n "$INPUT_MATCH" ] && echo PASS || echo FAIL)

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
echo "grade: gate change-correlation  = $CHANGE_GATE ${CHANGE_MATCH:+-> $CHANGE_MATCH}"
echo "grade: gate input-ruled-out     = $INPUT_GATE ${INPUT_MATCH:+-> $INPUT_MATCH}"
echo "grade: gate latch-walk          = $LATCH_GATE ${LATCH_MATCH:+-> $LATCH_MATCH}"
echo "SCORE steps=$STEPS change_correlation=$CHANGE_GATE input_ruled_out=$INPUT_GATE latch_walk=$LATCH_GATE"

echo "grade: --- residue (NOT checked) ---"
echo "grade:  * that any number in the report is correct"
echo "grade:  * that the diagnosis is right or the named rollback would work"
echo "grade:  * that a matched section carries meaningful content (a heading"
echo "grade:    with the right words passes — presence, not correctness)"
echo "grade:  * that the step count reflects real work rather than padding"

# Exit 0 when the required gate (change-correlation) passes. The step count is
# the demo metric and is reported, never a pass/fail on its own.
[ "$CHANGE_GATE" = "PASS" ]
