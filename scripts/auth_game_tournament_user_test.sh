#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
BASE_URL="${BASE_URL:-https://localhost:8443}"
GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-ft_transcendence-gateway-1}"
CURL="${CURL:-curl}"
JQ="${JQ:-jq}"

# --- Helpers ---
color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
ok()     { color "32" "✓ $*"; }
info()   { color "36" "ℹ $*"; }
warn()   { color "33" "⚠ $*"; }
fail()   { color "31" "✗ $*"; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "commande requise manquante: $1"; }

curl_json() {
  local method="$1"; shift
  local url="$1"; shift
  local body="${1-}"
  local token="${2-}"

  [[ "$url" =~ ^https?:// ]] || url="${BASE_URL}${url}"

  local args=(-k -sS -X "$method" "$url")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer ${token}")
  [[ -n "$body"  ]] && args+=(-H 'Content-Type: application/json' --data-raw "$body")

  "${CURL}" "${args[@]}"
}

try_docker_node() {
  if docker ps --format '{{.Names}}' | grep -q "^${GATEWAY_CONTAINER}\$"; then
    docker exec -it "${GATEWAY_CONTAINER}" node -e "$1"
  else
    warn "container ${GATEWAY_CONTAINER} introuvable — étape interne ignorée"
  fi
}

# --- Checks ---
need_cmd "${CURL}"
need_cmd "${JQ}"

info "Base URL: ${BASE_URL}"

# --- 0) Pings internes ---
info "Ping svc-auth, svc-user, svc-game, svc-tournament…"
try_docker_node "fetch('http://auth:8101/ping').then(r=>r.text()).then(console.log).catch(console.error)"
try_docker_node "fetch('http://user:8106/ping').then(r=>r.text()).then(console.log).catch(console.error)"
try_docker_node "fetch('http://game:8102/ping').then(r=>r.text()).then(console.log).catch(console.error)"
try_docker_node "fetch('http://tournament:8104/ping').then(r=>r.text()).then(console.log).catch(console.error)"

# =========================
# === 1) AUTH & USERS   ===
# =========================

ts=$(date +%s)
ALICE="alice$ts"
ALICE_EMAIL="${ALICE}@example.test"
BOB="bob$ts"
BOB_EMAIL="${BOB}@example.test"

info "Register ALICE: ${ALICE}"
R1=$(curl_json POST /api/users/register "{\"username\":\"${ALICE}\",\"email\":\"${ALICE_EMAIL}\",\"password\":\"secret\"}")
echo "$R1" | $JQ .
ALICE_ID=$(echo "$R1" | $JQ -r '.user.id')

info "Login ALICE…"
L1=$(curl_json POST /api/users/login "{\"username\":\"${ALICE}\",\"password\":\"secret\"}")
echo "$L1" | $JQ .
TOKEN_ALICE=$(echo "$L1" | $JQ -r '.token')
ok "ALICE ok id=${ALICE_ID}"

info "Register BOB: ${BOB}"
R2=$(curl_json POST /api/users/register "{\"username\":\"${BOB}\",\"email\":\"${BOB_EMAIL}\",\"password\":\"secret\"}")
echo "$R2" | $JQ .
BOB_ID=$(echo "$R2" | $JQ -r '.user.id')

info "Login BOB…"
L2=$(curl_json POST /api/users/login "{\"username\":\"${BOB}\",\"password\":\"secret\"}")
echo "$L2" | $JQ .
TOKEN_BOB=$(echo "$L2" | $JQ -r '.token')
ok "BOB ok id=${BOB_ID}"

# --- Profile tests ---
info "== Tests PROFILE =="
info "payload vide"
curl_json PUT /api/users/profile '{}' "$TOKEN_ALICE" | $JQ .
info "username court"
curl_json PUT /api/users/profile '{"username":"ab"}' "$TOKEN_ALICE" | $JQ .
NEW_ALICE="new$ALICE"
info "update OK"
curl_json PUT /api/users/profile "{\"username\":\"$NEW_ALICE\",\"avatar\":\"https://picsum.photos/200\"}" "$TOKEN_ALICE" | $JQ .
info "conflit username (BOB prend $NEW_ALICE)"
curl_json PUT /api/users/profile "{\"username\":\"$NEW_ALICE\"}" "$TOKEN_BOB" | $JQ .

# =========================
# === 2) GAMES ============
# =========================

info "Lister les games"
curl_json GET /api/games | $JQ .

info "Création game (waiting) par ALICE"
G1=$(curl_json POST /api/games '{"status":"waiting"}' "$TOKEN_ALICE")
echo "$G1" | $JQ .
GAME_WAITING_ID=$(echo "$G1" | $JQ -r '.gameId')

info "Création game playing (ALICE vs BOB)"
G2=$(curl_json POST /api/games "{\"player2_id\":${BOB_ID},\"status\":\"playing\"}" "$TOKEN_ALICE")
echo "$G2" | $JQ .

info "Validation join (BOB rejoint waiting ${GAME_WAITING_ID})"
try_docker_node "
fetch('http://game:8102/validate-game-join',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({
    gameState: { id:${GAME_WAITING_ID}, player1_id:${ALICE_ID}, player2_id:null, status:'waiting' },
    currentUserId: ${BOB_ID}
  })
}).then(r=>r.text()).then(console.log).catch(console.error)
"

info "Validation score"
try_docker_node "
fetch('http://game:8102/validate-score-update',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({
    gameState:{ id:${GAME_WAITING_ID}, player1_id:${ALICE_ID}, player2_id:${BOB_ID}, status:'playing' },
    player1_score: 3, player2_score: 2, currentUserId: ${ALICE_ID}
  })
}).then(r=>r.text()).then(console.log).catch(console.error)
"

info "Validation finish"
try_docker_node "
fetch('http://game:8102/validate-game-finish',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({
    gameState:{ id:${GAME_WAITING_ID}, player1_id:${ALICE_ID}, player2_id:${BOB_ID}, status:'playing' },
    winner_id: ${ALICE_ID}, currentUserId: ${ALICE_ID}
  })
}).then(r=>r.text()).then(console.log).catch(console.error)
"

# =========================
# === 3) TOURNAMENTS ======
# =========================

info "Création tournoi par ALICE"
T_CREATE=$(curl_json POST /api/tournaments '{"name":"Open Pong","description":"GL HF","max_players":8}' "$TOKEN_ALICE")
echo "$T_CREATE" | $JQ .
TID=$(echo "$T_CREATE" | $JQ -r '.tournamentId')

info "Lister tournois"
curl_json GET /api/tournaments | $JQ .

info "BOB rejoint tournoi $TID"
curl_json POST "/api/tournaments/${TID}/join" '' "$TOKEN_BOB" | $JQ .

info "ALICE démarre tournoi $TID"
curl_json POST "/api/tournaments/${TID}/start" '' "$TOKEN_ALICE" | $JQ .

info "Vérifier participants"
curl_json GET "/api/tournaments/${TID}/participants" | $JQ .

ok "E2E tests terminés ✔"
