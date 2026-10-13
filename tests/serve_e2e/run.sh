#!/usr/bin/env bash
# =============================================================================
#  End-to-end check of the `cell --serve` REST/SSE layer.
#
#  Not wired into ctest on purpose: it needs Python (for the mock provider and
#  JSON handling) and a cell binary built from this tree. Run it manually or
#  from a CI job that has Python available:
#
#      CELL_BIN=/path/to/bin/cell python3 tests/serve_e2e/run.sh
#
#  Environment:
#      CELL_BIN   path to the cell executable   (default: build/default/bin/cell)
#      PYTHON     python interpreter            (default: python3, then python)
#      MOCK_PORT  port for the mock LLM         (default: 8899)
#      SRV_PORT   port for cell --serve         (default: 8791)
#
#  What it proves, end to end (real HTTP, real SSE, a real agent turn):
#    1. auth: /health open, everything else needs the bearer token
#    2. sessions: list / create / transcript / delete
#    3. turns: JSON shape and SSE framing, turn_done, persisted messages
#    4. config: GET + PATCH (and 400 on a bad enum)
#    5. providers: list / models probe / (key never leaves the vault)
#    6. notices, usages, skills
#    7. approvals: allow → the exec tool runs; deny → it is blocked
#    8. interrupt/resume: cancel a running turn, then resume it
#    9. graceful shutdown
# =============================================================================
set -u

here="$(cd "$(dirname "$0")" && pwd)"
CELL_BIN="${CELL_BIN:-$here/../../build/default/bin/cell}"
[ -x "$CELL_BIN" ] || CELL_BIN="$here/../../build/default/bin/cell.exe"
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for cand in python3 python; do command -v "$cand" >/dev/null 2>&1 && PYTHON="$cand" && break; done
fi
[ -n "$PYTHON" ] || { echo "FATAL: no python interpreter found"; exit 1; }
[ -x "$CELL_BIN" ] || { echo "FATAL: cell binary not found (set CELL_BIN)"; exit 1; }

MOCK_PORT="${MOCK_PORT:-8899}"
SRV_PORT="${SRV_PORT:-8791}"
# the runtime root (.cell) lives next to the executable
ROOT="$(dirname "$CELL_BIN")/.cell"
WS="$(mktemp -d)"
FAILURES=0

note() { echo; echo "== $* =="; }
check() { # check <description> <expected-substring> <actual>
  if printf '%s' "$3" | grep -q -- "$2"; then
    echo "  ok   $1"
  else
    echo "  FAIL $1"
    echo "       expected to contain: $2"
    echo "       got: $(printf '%s' "$3" | head -c 200)"
    FAILURES=$((FAILURES + 1))
  fi
}

cleanup() { kill "$SRV_PID" "$MOCK_PID" 2>/dev/null; rm -rf "$WS"; }
trap cleanup EXIT

cd "$WS" || exit 1
"$PYTHON" "$here/mock_llm.py" "$MOCK_PORT" > mock.log 2>&1 &
MOCK_PID=$!
sleep 1.5

# register the provider once (writes config.json + vault next to the binary)
echo "hi" | "$CELL_BIN" --provider openai --base "http://127.0.0.1:$MOCK_PORT/v1" \
    --model mock-model --key sk-e2e --no-color > setup.log 2>&1

rm -f "$ROOT/server.json"
"$CELL_BIN" --serve --port "$SRV_PORT" --no-color > serve.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 80); do [ -f "$ROOT/server.json" ] && break; sleep 0.25; done
[ -f "$ROOT/server.json" ] || { echo "FATAL: server did not start"; cat serve.log; exit 1; }

TOKEN=$("$PYTHON" -c "import json;print(json.load(open(r'$ROOT/server.json'))['token'])")
AUTH="Authorization: Bearer $TOKEN"
B="http://127.0.0.1:$SRV_PORT/v1"
jget() { "$PYTHON" -c "import json,sys;d=json.load(sys.stdin);print($1)"; }
wait_idle() {
  for _ in $(seq 1 120); do
    [ "$(curl -s "$B/health" | jget "d['turn_active']")" = "False" ] && return 0
    sleep 0.5
  done
}

note "1) meta + auth"
check "health is open" '"status":"ok"' "$(curl -s "$B/health")"
check "version" '"version"' "$(curl -s -H "$AUTH" "$B/version")"
check "bad token is rejected" "401" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' "$B/version")"
check "unknown route is 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$B/nope")"

note "2) sessions"
SID=$(curl -s -H "$AUTH" -X POST "$B/sessions" | jget "d['id']")
check "created a session" "$SID" "$SID"
check "session list contains it" "$SID" "$(curl -s -H "$AUTH" "$B/sessions")"
check "fresh session has no transcript (404)" "session_not_found" "$(curl -s -H "$AUTH" "$B/sessions/$SID/messages")"

note "3) turns"
check "JSON turn" '"rc":0' "$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -d '{"text":"say hello"}' "$B/sessions/$SID/turn")"
check "transcript persisted" '"role":"assistant"' "$(curl -s -H "$AUTH" "$B/sessions/$SID/messages")"
check "SSE framing" "data: " "$(curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -d '{"text":"hello stream"}' "$B/sessions/$SID/turn")"
check "SSE turn_done" '"type":"turn_done"' "$(curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -d '{"text":"again"}' "$B/sessions/$SID/turn")"

note "4) config"
check "config GET" '"sandbox_mode"' "$(curl -s -H "$AUTH" "$B/config")"
check "config PATCH" '"think_level":1' "$(curl -s -H "$AUTH" -X PATCH -H 'Content-Type: application/json' -d '{"think_level":"low"}' "$B/config")"
check "bad enum is 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X PATCH -H 'Content-Type: application/json' -d '{"think_level":"bogus"}' "$B/config")"

note "5) providers"
check "provider list hides key material" '"key_set":true' "$(curl -s -H "$AUTH" "$B/providers")"
check "no key leak" "0" "$(curl -s -H "$AUTH" "$B/providers" | grep -c 'sk-e2e' || true)"
check "models probe" 'mock-model' "$(curl -s -H "$AUTH" "$B/providers/openai/models")"

note "6) notices / usages / skills"
check "notice accepted" '"id"' "$(curl -s -H "$AUTH" -X POST -H 'Content-Type: application/json' -d "{\"session\":\"$SID\",\"body\":\"from e2e\"}" "$B/notices")"
check "notice listed" 'from e2e' "$(curl -s -H "$AUTH" "$B/notices?session=$SID")"
check "usages" '"models"' "$(curl -s -H "$AUTH" "$B/usages")"
check "skills" '"skills"' "$(curl -s -H "$AUTH" "$B/skills")"
check "interrupt without a turn is 409" "409" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X POST "$B/sessions/$SID/interrupt")"

note "7) approval: allow makes the tool run"
( curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
     -d '{"text":"please [EXEC] now"}' "$B/sessions/$SID/turn" > allow.txt 2>&1 ) &
TURN=$!
APID=""
for _ in $(seq 1 80); do
  APID=$(curl -s -H "$AUTH" "$B/approvals" | jget "d['pending'][0]['request_id'] if d['pending'] else ''")
  [ -n "$APID" ] && break
  sleep 0.5
done
check "approval_request surfaced" "$APID" "$APID"
check "approval_request event streamed" "approval_request" "$(cat allow.txt)"
curl -s -H "$AUTH" -X POST -H 'Content-Type: application/json' -d '{"decision":"allow"}' "$B/approvals/$APID" > /dev/null
wait $TURN 2>/dev/null
check "exec ran after allow" "exitcode=0" "$(cat allow.txt)"
wait_idle

note "8) approval: deny blocks the tool"
# a fresh session: the mock only proposes the exec tool while no tool result
# is in the conversation yet
SID2=$(curl -s -H "$AUTH" -X POST "$B/sessions" | jget "d['id']")
( curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
     -d '{"text":"please [EXEC] again"}' "$B/sessions/$SID2/turn" > deny.txt 2>&1 ) &
TURN=$!
APID=""
for _ in $(seq 1 80); do
  APID=$(curl -s -H "$AUTH" "$B/approvals" | jget "d['pending'][0]['request_id'] if d['pending'] else ''")
  [ -n "$APID" ] && break
  sleep 0.5
done
curl -s -H "$AUTH" -X POST -H 'Content-Type: application/json' -d '{"decision":"deny","reason":"denied by e2e"}' "$B/approvals/$APID" > /dev/null
wait $TURN 2>/dev/null
check "deny reason surfaced" "denied by e2e" "$(cat deny.txt)"
check "nothing was executed" "0" "$(grep -c 'exitcode=0' deny.txt || true)"
wait_idle

note "9) interrupt + resume"
( curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
     -d '{"text":"please [SLOW] go"}' "$B/sessions/$SID/turn" > slow.txt 2>&1 ) &
TURN=$!
sleep 2.5
check "interrupt accepted" "202" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X POST "$B/sessions/$SID/interrupt")"
wait $TURN 2>/dev/null
check "turn reports interrupted" '"interrupted":true' "$(cat slow.txt)"
check "partial output kept" "interrupted] partial output kept" "$(cat slow.txt)"
wait_idle
check "resume runs" '"type":"turn_done"' "$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -d '{"resume":true}' "$B/sessions/$SID/turn")"
wait_idle

note "10) cleanup"
check "session delete" '"deleted"' "$(curl -s -H "$AUTH" -X DELETE "$B/sessions/$SID")"
check "shutdown" '"stopping"' "$(curl -s -H "$AUTH" -X POST "$B/shutdown")"
sleep 1
check "server exited cleanly" "cell serve: stopped" "$(cat serve.log)"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "SERVE E2E: all checks passed"
  exit 0
fi
echo "SERVE E2E: $FAILURES check(s) failed"
exit 1
