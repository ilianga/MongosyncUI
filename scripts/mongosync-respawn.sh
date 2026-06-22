#!/usr/bin/env bash
# Keeps a mongosync process alive with backoff and a crash-loop cap.
# Args: <bin> <configPath> <logDir> <statusFile> <stopSentinel> <backoffCapSec> <crashLoopMax> <crashLoopWindowSec>
set -u

BIN="$1"; CONFIG="$2"; LOGDIR="$3"; STATUS="$4"; STOP="$5"
BACKOFF_CAP="${6:-60}"; CRASH_MAX="${7:-5}"; CRASH_WINDOW="${8:-300}"

attempt=0
backoff=2
window_start=$(date +%s)
window_count=0

write_status() { # $1=state $2=lastExitCode(JSON number or null)
  printf '{"attempt":%d,"lastExitCode":%s,"lastStartAt":%d,"state":"%s"}\n' \
    "$attempt" "$2" "$(date +%s)" "$1" > "$STATUS"
}

while true; do
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi
  attempt=$((attempt + 1))
  write_status "running" "null"
  # 2>&1 | tee keeps output visible in `tmux attach` AND persisted for the logs panel.
  "$BIN" --config "$CONFIG" 2>&1 | tee -a "$LOGDIR/stdout.log"
  code=${PIPESTATUS[0]}
  write_status "running" "$code"
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi

  now=$(date +%s)
  if [ $((now - window_start)) -gt "$CRASH_WINDOW" ]; then
    window_start=$now; window_count=0
  fi
  window_count=$((window_count + 1))
  if [ "$window_count" -ge "$CRASH_MAX" ]; then
    write_status "crash_looping" "$code"
    break
  fi

  sleep "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt "$BACKOFF_CAP" ]; then backoff="$BACKOFF_CAP"; fi
done
