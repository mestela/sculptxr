#!/usr/bin/env zsh
# SWEEP EVERY HARNESS'S DEFECT INJECTIONS AND REPORT THE DEAD ONES.
#
# The harnesses in scratchpad/ inject defects by string-replacing an anchor in the SOURCE TEXT.
# That makes them precise and it makes them fragile in one specific way: any refactor that
# reformats an anchored line silently kills the injection, the harness reports "all checks
# passed", and the check it was proving is no longer proving anything. 41/41 green is not
# evidence unless the injections still bite.
#
# So after touching a file a harness reads, run this. It runs each harness once per declared
# injection and sorts the results into three:
#
#   DEAD    the anchor no longer exists -- the injection cannot even be applied. Fix the anchor.
#   MISSED  the defect applied cleanly and every check still passed -- the harness does not
#           actually test the thing it claims to. Worse than DEAD, because nothing shouts.
#   caught  the defect applied and the harness failed. Working as intended.
#
# Injection names are read out of each harness's own `NAME_INJECT=xxx` header comments, which is
# where they are already documented, so a new injection is swept the moment it is written down.
#
# THE ZSH TRAP THIS SCRIPT EXISTS TO AVOID: do not word-split the harness list by hand. An
# unquoted $(...) in zsh does NOT split on whitespace the way bash does, so a naive loop runs one
# giant "filename" and reports nothing at all -- looking exactly like a clean sweep.

set -u
cd "${0:A:h}/.." || exit 1

typeset -a only
only=("$@")

dead=0; missed=0; caught=0

for f in scratchpad/*_test.mjs; do
  base="${f:t:r}"
  if (( ${#only} )) && [[ " ${only[*]} " != *" ${base} "* ]]; then continue; fi

  # The env var name and the injection names, straight out of the header comments.
  var=$(grep -o -m1 '[A-Z][A-Z0-9_]*_INJECT=' "$f" | head -1 | tr -d '=')
  [[ -z "$var" ]] && continue
  names=(${(f)"$(grep -o "${var}=[a-zA-Z0-9_]*" "$f" | sed "s/${var}=//" | sort -u)"})
  (( ${#names} )) || continue

  echo "── $base  (${var}, ${#names} injections)"
  for n in $names; do
    out=$(env "${var}=${n}" node "$f" 2>&1)
    if echo "$out" | grep -q 'anchor moved'; then
      echo "   DEAD    $n"; (( dead++ ))
    elif echo "$out" | grep -q '^  FAIL'; then
      echo "   caught  $n"; (( caught++ ))
    else
      echo "   *** MISSED $n ***"; (( missed++ ))
    fi
  done
done

echo
echo "caught $caught   DEAD $dead   MISSED $missed"
(( dead + missed )) && exit 1
exit 0
