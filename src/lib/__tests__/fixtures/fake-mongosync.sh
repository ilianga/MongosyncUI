#!/usr/bin/env bash
# Fake mongosync for fault injection. Ignores --config. Behavior via env:
#   FAKE_MODE=normal|crash|hang   FAKE_PORT=<port>   FAKE_STATE=<IDLE|RUNNING>
set -u
MODE="${FAKE_MODE:-normal}"
PORT="${FAKE_PORT:-27199}"
STATE="${FAKE_STATE:-RUNNING}"

if [ "$MODE" = "crash" ]; then
  exit 7
fi

# Serve a minimal /api/v1/progress using nc, looping. "hang" mode sleeps without serving.
if [ "$MODE" = "hang" ]; then
  sleep 3600
  exit 0
fi

BODY='{"success":true,"progress":{"state":"'"$STATE"'","canCommit":false,"canWrite":false}}'
while true; do
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s' \
    "${#BODY}" "$BODY" | nc -l "$PORT" >/dev/null 2>&1 || sleep 1
done
