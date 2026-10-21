#!/bin/bash
# All suites, one after the other; exits with an error if any check fails. Needs `npm install` once (jsdom).
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0
for suite in "run.sh order-ui.js" "run.sh editor-ui.js" "run-campaigns.sh" "run-auth.sh"; do
  echo "== $suite"
  out=$(bash "$HERE/${suite%% *}" ${suite#* } 2>&1); echo "$out"
  echo "$out" | grep -qE "FAIL|ERROR" && fail=1
done
[ $fail = 0 ] && echo "ALL SUITES PASS" || echo "SOME CHECKS FAILED"
exit $fail
