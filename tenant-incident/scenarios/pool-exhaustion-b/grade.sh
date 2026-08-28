#!/usr/bin/env bash
# Score a diagnosis report for the catalog timeout-storm incident.
#
# PRESENCE, NOT CORRECTNESS. This is a floor, not a judge. It counts declared
# steps and checks that the report mentions the things a pool-aware diagnosis
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
    --max-steps) MAX_STEPS="${2:-}"; shift 2 ;;
    *)           REPORT="$1"; shift ;;
  esac
done
REPORT="${REPORT:-$SCRIPT_DIR/fixtures/diagnosis-good.md}"

if [ ! -f "$REPORT" ]; then
  echo "grade: report not found: $REPORT" >&2
  exit 2
fi

# ── Step count ────────────────────────────────────────────────────────────
# Authoritative: a `steps:` integer in the frontmatter. Fallback: ordered-list
# items outside code fences (fenced numbered lines do not count as steps).
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

# ── Gate: pool-metrics section ─────────────────────────────────────────────
# A heading naming the pool, with a saturation token inside that section.
POOL_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /^#+[[:space:]].*pool/ { insec = 1; heading = $0; next }
  insec && l ~ /^#+[[:space:]]/ { insec = 0 }
  insec && l ~ /saturat|exhaust|waiting|in.?use|checked.?out|acquire/ {
    print heading " >> " $0; exit
  }
' "$REPORT")
POOL_GATE=$([ -n "$POOL_MATCH" ] && echo PASS || echo FAIL)

# ── Gate: datastore ruled out ──────────────────────────────────────────────
DB_MATCH=$(awk '
  { l = tolower($0) }
  l ~ /(postgres|redis|datastore|database|backend| db )/ &&
  l ~ /(healthy|ruled out|not the|idle|low load|accepts|excluded|is fine)/ {
    print; exit
  }
' "$REPORT")
DB_GATE=$([ -n "$DB_MATCH" ] && echo PASS || echo FAIL)

# ── Gate: latch-walk attestation ───────────────────────────────────────────
# Presumes an ember-style responder that records a latch-walk line. See the
# README limits: a correct pool diagnosis from another producer fails only this
# gate. The canonical attestation format belongs to the `session` skill.
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
echo "grade: gate pool-metrics       = $POOL_GATE ${POOL_MATCH:+-> $POOL_MATCH}"
echo "grade: gate datastore-ruled-out= $DB_GATE ${DB_MATCH:+-> $DB_MATCH}"
echo "grade: gate latch-walk         = $LATCH_GATE ${LATCH_MATCH:+-> $LATCH_MATCH}"
echo "SCORE steps=$STEPS pool_metrics=$POOL_GATE datastore_ruled_out=$DB_GATE latch_walk=$LATCH_GATE"

echo "grade: --- residue (NOT checked) ---"
echo "grade:  * that any number in the report is correct"
echo "grade:  * that the diagnosis is right or the named fix would work"
echo "grade:  * that a matched section carries meaningful content (a heading"
echo "grade:    with the right words passes — presence, not correctness)"
echo "grade:  * that the step count reflects real work rather than padding"

# Exit 0 when the required gate (pool-metrics) passes. The step count is the
# demo metric and is reported, never a pass/fail on its own.
[ "$POOL_GATE" = "PASS" ]
