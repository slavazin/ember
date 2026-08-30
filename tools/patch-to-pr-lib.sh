# shellcheck shell=bash
# Sourceable helpers for tools/patch-to-pr.sh, split out so the parse-fidelity
# battery (tools/patch-to-pr-lib.test.sh) can exercise them in isolation. This
# one function has re-earned the parse-fidelity class three times inside one PR
# (blindspots BS-0055 CRLF delimiter, BS-0059 inline comment, BS-0061 quoted '#'),
# so its behaviour is now pinned by a test rather than left to the next reviewer.
# The file is sourced, never executed: it defines functions and nothing else.

# Read one scalar from the FIRST YAML frontmatter block of a file (CR-tolerant). Keyed
# on `^<key>:` so `incident:` never matches `incident-class:`. A quoted scalar is returned
# as its verbatim between-the-quotes content (any surrounding quotes the caller strips are
# then a no-op); an unquoted scalar has a trailing inline comment stripped. Prints nothing
# when the field (or the frontmatter) is absent.
read_fm() {
  awk -v key="$2" '
    { sub(/\r$/,"") }                 # normalize CRLF on EVERY line before any delimiter check
    NR==1 && $0 != "---" { exit }
    NR==1 { infm=1; next }
    infm && $0 == "---" { exit }
    infm {
      if ($0 ~ ("^" key ":")) {
        val=$0; sub(("^" key ":[ \t]*"),"",val)
        # A "#" is a comment ONLY in an unquoted scalar; inside quotes it is data
        # (YAML 1.2.2 §7.3). For a quoted scalar, take the content up to the matching
        # close quote verbatim — an embedded "#" survives so the caller safe-id check
        # rejects a malformed id rather than silently truncating it to a different one.
        # An unterminated quote leaves val as-is (also rejected). \047 is a single quote.
        q=substr(val,1,1)
        if (q=="\"" || q=="\047") {
          rest=substr(val,2); i=index(rest,q)
          if (i>0) val=substr(rest,1,i-1)
        } else {
          sub(/[ \t]+#.*/,"",val)     # unquoted: drop a YAML inline comment (whitespace + # …)
        }
        sub(/[ \t]+$/,"",val)
        print val; exit
      }
    }
  ' "$1"
}
