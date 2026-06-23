#!/usr/bin/env bash
# Keeps a mongosync process alive with backoff and a crash-loop cap.
# Args: <bin> <configPath> <logDir> <statusFile> <stopSentinel> <backoffCapSec> <crashLoopMax> <crashLoopWindowSec>
set -u

BIN="$1"; CONFIG="$2"; LOGDIR="$3"; STATUS="$4"; STOP="$5"
BACKOFF_CAP="${6:-60}"; CRASH_MAX="${7:-5}"; CRASH_WINDOW="${8:-300}"

# Capture epoch once so write_status avoids repeated $(date +%s) forks.
# bash $SECONDS counts seconds since script start; add to epoch gives current Unix time.
EPOCH_AT_START=$(date +%s)

attempt=0
backoff=2; if [ "$backoff" -gt "$BACKOFF_CAP" ]; then backoff="$BACKOFF_CAP"; fi
window_start=$SECONDS
window_count=0

write_status() { # $1=state $2=lastExitCode(JSON number or null)
  # printf is a bash built-in; $((expr)) is built-in arithmetic — no subprocess fork.
  printf '{"attempt":%d,"lastExitCode":%s,"lastStartAt":%d,"state":"%s"}\n' \
    "$attempt" "$2" "$((EPOCH_AT_START + SECONDS))" "$1" > "$STATUS"
}

while true; do
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi
  attempt=$((attempt + 1))
  write_status "running" "null"
  # Redirect to log file directly — avoids the anonymous pipe in "cmd | tee" which can
  # stall on macOS/bash 3.2 if the write-end is not closed promptly.
  # Users wanting live output can run: tail -f "$LOGDIR/stdout.log" in another pane.
  "$BIN" --config "$CONFIG" >> "$LOGDIR/stdout.log" 2>&1
  code=$?
  write_status "running" "$code"
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi

  now=$SECONDS
  if [ $((now - window_start)) -gt "$CRASH_WINDOW" ]; then
    window_start=$now; window_count=0
  fi
  window_count=$((window_count + 1))
  if [ "$window_count" -ge "$CRASH_MAX" ]; then
    write_status "crash_looping" "$code"
    break
  fi

  # Use "read -t N" (bash built-in) instead of the external "sleep" command.
  # On macOS/bash 3.2 the external sleep can stall indefinitely inside tmux sessions.
  # Skip entirely when backoff is 0 to avoid even the trivial syscall overhead.
  if [ "$backoff" -gt 0 ]; then
    read -r -t "$backoff" < /dev/null 2>/dev/null || true
  fi
  backoff=$((backoff * 2))
  if [ "$backoff" -gt "$BACKOFF_CAP" ]; then backoff="$BACKOFF_CAP"; fi
done
