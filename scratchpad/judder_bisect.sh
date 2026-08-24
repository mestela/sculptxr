#!/bin/bash
# Judder bisect driver.
#
# Each step is one command and one headset reload. Vite is already watching, so a checkout
# is picked up by reloading the page — there is no rebuild between steps.
#
#   scratchpad/judder_bisect.sh start   <good-commit> <bad-commit>
#   scratchpad/judder_bisect.sh good    # this build does NOT judder
#   scratchpad/judder_bisect.sh bad     # this build DOES judder
#   scratchpad/judder_bisect.sh stop    # abandon, return to master
#
# TEST THE SAME WAY EVERY TIME or the result is noise: same scene, same rig, bones and trails
# OFF (that is the condition the regression was reported under), look for ~10 seconds without
# moving, then again while turning your head.
set -e
cd "$(dirname "$0")/.."

show() {
  local v
  v=$(grep -oE "v3\.[0-9]+\.[0-9]+" src/Version.js | head -1)
  echo
  echo "  now on: $v   $(git log -1 --format=%h' '%s | cut -c1-70)"
  echo "  reload the headset, then: scratchpad/judder_bisect.sh good|bad"
  echo
}

case "$1" in
  start)
    git bisect start
    git bisect bad "${3:-HEAD}"
    git bisect good "$2"
    show ;;
  good|bad)
    out=$(git bisect "$1")
    echo "$out"
    if echo "$out" | grep -q "is the first bad commit"; then
      echo
      echo "  FOUND IT. 'git bisect reset' to come back to master."
    else
      show
    fi ;;
  stop)  git bisect reset ;;
  *)     echo "usage: $0 start <good> <bad> | good | bad | stop"; exit 1 ;;
esac
