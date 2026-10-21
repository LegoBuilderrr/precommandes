#!/bin/bash
# start a fresh test server on :8444 (killing whatever listens there), run one UI suite
stop(){ for p in $(ss -ltnp 2>/dev/null | grep ':8444 ' | grep -oE 'pid=[0-9]+' | cut -d= -f2); do kill $p 2>/dev/null; done; sleep 1; }
stop; rm -rf /tmp/t4.db* /tmp/t4-uploads
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
DB_FILE=/tmp/t4.db UPLOAD_DIR=/tmp/t4-uploads PORT=8444 node --disable-warning=ExperimentalWarning ./src/server.js > /tmp/t4.log 2>&1 &
sleep 2
# the shop only takes orders while a delivery is ahead: give the seeded campaign one
node --no-warnings -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/tmp/t4.db');d.prepare('INSERT OR IGNORE INTO deliveries (campaign_id,date) VALUES (1,?)').run(new Date(Date.now()+30*864e5).toISOString().slice(0,10))"
cd "$HERE"
node "$1" 2>&1 | grep -E "^(PASS|FAIL|ERROR)" > $HERE/out.txt
awk '{c[$1]++} END{for(k in c) print "  "k, c[k]}' $HERE/out.txt; grep -E "^(FAIL|ERROR)" $HERE/out.txt
stop
