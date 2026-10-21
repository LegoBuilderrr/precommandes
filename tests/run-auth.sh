#!/bin/bash
# the admin login (password only, signed cookie) under a /precommandes prefix, on :8449
stop(){ for p in $(ss -ltnp 2>/dev/null | grep ':8449 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2); do kill $p 2>/dev/null; done; sleep 1; }
stop; rm -rf /tmp/t9.db* /tmp/t9-up
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
DB_FILE=/tmp/t9.db UPLOAD_DIR=/tmp/t9-up PORT=8449 PLAIN_HTTP=1 BASE_URL=http://127.0.0.1:8449/precommandes ADMIN_PASSWORD=admin node --disable-warning=ExperimentalWarning ./src/server.js > /tmp/t9.log 2>&1 &
sleep 2; cd "$HERE"
node auth-test.js 2>&1 | grep -E "^(PASS|FAIL|ERROR)" | tee $HERE/out9.txt | grep -E "^(FAIL|ERROR)"
awk '{c[$1]++} END{for(k in c) print "  "k, c[k]}' $HERE/out9.txt
stop
