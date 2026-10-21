#!/bin/bash
stop(){ for p in $(ss -ltnp 2>/dev/null | grep ':8448 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2); do kill $p 2>/dev/null; done; sleep 1; }
stop; rm -rf /tmp/t8.db* /tmp/t8-up
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
DB_FILE=/tmp/t8.db UPLOAD_DIR=/tmp/t8-up PORT=8448 node --disable-warning=ExperimentalWarning ./src/server.js > /tmp/t8.log 2>&1 &
sleep 2; cd "$HERE"
node --disable-warning=ExperimentalWarning campaigns-test.js 2>&1 | grep -E "^(PASS|FAIL|ERROR)" | tee $HERE/out8.txt | grep -E "^(FAIL|ERROR)"
awk '{c[$1]++} END{for(k in c) print "  "k, c[k]}' $HERE/out8.txt
stop
