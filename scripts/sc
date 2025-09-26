#!/usr/bin/env bash
# E2E API checker - continue on errors, show full report
set -u -o pipefail  # (pas de -e : on veut continuer même si un test échoue)

BASE_URL="${BASE_URL:-https://localhost:8443}"
JQ="${JQ:-jq}"

# --------- UI helpers ----------
color(){ printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
ok(){ color 32 "✓ $*"; }
info(){ color 36 "ℹ $*"; }
bad(){ color 31 "✗ $*"; }
HAD_FAIL=0

# --------- HTTP helpers ----------
# Retourne: 1ère ligne = HTTP status, le reste = body
curl_json_status () {
  local method="$1"; shift
  local url="$1"; shift
  local body="${1-}"
  local token="${2-}"
  [[ "$url" =~ ^https?:// ]] || url="${BASE_URL}${url}"
  local args=(-k -sS -w "\n%{http_code}" -X "$method" "$url" -H "Accept: application/json")
  [[ -n "${token}" ]] && args+=(-H "Authorization: Bearer ${token}")
  [[ -n "${body}"  ]] && args+=(-H "Content-Type: application/json" --data-raw "$body")
  local out http
  out="$(curl "${args[@]}")" || out=$'\n000'
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"
  printf '%s\n%s' "$http" "$body"
}

# call "label" METHOD PATH EXPECTED_STATUS [TOKEN] [JSON_BODY]
call () {
  local label="$1"; shift
  local method="$1"; shift
  local path="$1"; shift
  local expect="$1"; shift
  local token="${1-}"; shift || true
  local payload="${1-}"

  local OUT STATUS BODY
  OUT="$(curl_json_status "$method" "$path" "${payload-}" "${token-}")"
  STATUS="${OUT%%$'\n'*}"
  BODY="${OUT#*$'\n'}"

  if [[ "$STATUS" == "$expect" ]]; then
    ok "$label"
  else
    bad "$label (expected $expect got $STATUS)"
    HAD_FAIL=1
  fi

  # Affiche le body joliment (sans faire échouer en cas d’erreur jq)
  echo "$BODY" | $JQ . 2>/dev/null || echo "$BODY"

  # Expose pour usage après l'appel
  REPLY_STATUS="$STATUS"
  REPLY_BODY="$BODY"
}

echo
echo "--------------------------------------------------------------------------------"
info "Base = $BASE_URL"

# --- Pings ---
echo
echo "--------------------------------------------------------------------------------"
info "Pings"
call "users ping"        GET /api/users/ping        200
call "games ping"        GET /api/games/ping        200
call "tournaments ping"  GET /api/tournaments/ping  200
call "healthz"           GET /healthz               200

# --- Register & Login ---
echo
echo "--------------------------------------------------------------------------------"
info "Register & Login"
TS=$(date +%s)
ALICE="alice$TS"
BOB="bob$TS"

call "register ALICE" POST /api/users/register 201 "" "{\"username\":\"$ALICE\",\"email\":\"$ALICE@example.test\",\"password\":\"secret\"}"
ALICE_ID=$(echo "$REPLY_BODY" | $JQ -r '.user.id')

call "login ALICE"    POST /api/users/login    200 "" "{\"username\":\"$ALICE\",\"password\":\"secret\"}"
TOKEN_ALICE=$(echo "$REPLY_BODY" | $JQ -r '.token')

call "register BOB"   POST /api/users/register 201 "" "{\"username\":\"$BOB\",\"email\":\"$BOB@example.test\",\"password\":\"secret\"}"
BOB_ID=$(echo "$REPLY_BODY" | $JQ -r '.user.id')

call "login BOB"      POST /api/users/login    200 "" "{\"username\":\"$BOB\",\"password\":\"secret\"}"
TOKEN_BOB=$(echo "$REPLY_BODY" | $JQ -r '.token')

# --- Profile + collision ---
echo
echo "--------------------------------------------------------------------------------"
info "Profile + Collisions"
NEW_ALICE="new$ALICE"
call "profile update ALICE" PUT /api/users/profile 200 "$TOKEN_ALICE" "{\"username\":\"$NEW_ALICE\",\"avatar\":\"https://picsum.photos/200\"}"
call "collision username -> 409" PUT /api/users/profile 409 "$TOKEN_BOB" "{\"username\":\"$NEW_ALICE\"}"

# --- /me + public profile ---
echo
echo "--------------------------------------------------------------------------------"
info "/me & public profile"
call "/api/users/me"        GET /api/users/me            200 "$TOKEN_ALICE"
call "public profile ALICE" GET "/api/users/$ALICE_ID/profile" 200

# --- Friendships ---
echo
echo "--------------------------------------------------------------------------------"
info "Friendships"
call "ALICE -> request BOB" POST "/api/users/$BOB_ID/friendship" 200 "$TOKEN_ALICE" "{\"action\":\"request\"}"
call "BOB -> accept ALICE"  POST "/api/users/$ALICE_ID/friendship" 200 "$TOKEN_BOB" "{\"action\":\"accept\"}"
call "friends (accepted)"   GET  "/api/users/$ALICE_ID/friends"    200
call "ALICE -> block BOB"   POST "/api/users/$BOB_ID/friendship"   200 "$TOKEN_ALICE" "{\"action\":\"block\"}"
call "friends (blocked)"    GET  "/api/users/$ALICE_ID/friends"    200

# --- Search users ---
echo
echo "--------------------------------------------------------------------------------"
info "Search users"
call "search 'ali'" GET "/api/users/search?q=ali" 200

# --- Games ---
echo
echo "--------------------------------------------------------------------------------"
info "Games"
call "unauthorized guard" POST /api/games 401 "" "{\"status\":\"waiting\"}"

call "create waiting game" POST /api/games 201 "$TOKEN_ALICE" "{\"status\":\"waiting\"}"
GW_ID=$(echo "$REPLY_BODY" | $JQ -r '.gameId')

call "create playing game" POST /api/games 201 "$TOKEN_ALICE" "{\"player2_id\":$BOB_ID,\"status\":\"playing\"}"
GPLAY_ID=$(echo "$REPLY_BODY" | $JQ -r '.gameId')

call "list games (all)"    GET  /api/games              200
call "list games (active)" GET  "/api/games?status=active" 200

# --- Finish game (tests 400 + OK) ---
echo
echo "--------------------------------------------------------------------------------"
info "Finish game"
call "finish wrong winner -> 400" POST "/api/games/$GPLAY_ID/finish" 400 "$TOKEN_ALICE" "{\"winner_id\":999999}"
call "finish ok (ALICE wins)"     POST "/api/games/$GPLAY_ID/finish" 200 "$TOKEN_ALICE" "{\"winner_id\":$ALICE_ID}"

# --- Tournaments ---
echo
echo "--------------------------------------------------------------------------------"
info "Tournaments"
call "create tournament" POST /api/tournaments 201 "$TOKEN_ALICE" "{\"name\":\"Open Pong\",\"description\":\"GL HF\",\"max_players\":8}"
TID=$(echo "$REPLY_BODY" | $JQ -r '.tournamentId')

call "BOB join"          POST "/api/tournaments/$TID/join"  200 "$TOKEN_BOB"
call "start tournament"  POST "/api/tournaments/$TID/start" 200 "$TOKEN_ALICE"
call "participants"      GET  "/api/tournaments/$TID/participants" 200
call "user tournaments"  GET  "/api/users/$ALICE_ID/tournaments"   200
call "tournaments list"  GET  /api/tournaments 200

echo
if [[ "$HAD_FAIL" -eq 0 ]]; then
  ok "E2E OK ✔"
  exit 0
else
  bad "E2E completed with failures — check the red lines above"
  exit 1
fi
