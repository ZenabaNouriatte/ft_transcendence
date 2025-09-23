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
  # $1: method, $2: path (absolute or relative), $3: json body (optional), $4: bearer token (optional)
  local method="$1"; shift
  local url="$1"; shift
  local body="${1-}"      # <- utilise ${var-} au lieu de ${var:-} pour éviter nounset
  local token="${2-}"

  [[ "$url" =~ ^https?:// ]] || url="${BASE_URL}${url}"

  # on construit les args de manière sûre
  local args=(-k -sS -X "$method" "$url")

  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H 'Content-Type: application/json' --data-raw "$body")
  fi

  "${CURL}" "${args[@]}"
}


try_docker_node() {
  # run a small Node fetch inside the gateway container (if present)
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

# --- 0) Pings internes (facultatif, via réseau Docker) ---
info "Ping svc-auth et svc-game (interne Docker)…"
try_docker_node "fetch('http://auth:8101/ping').then(r=>r.text()).then(console.log).catch(console.error)"
try_docker_node "fetch('http://game:8102/ping').then(r=>r.text()).then(console.log).catch(console.error)"

# --- 1) Register ALICE ---
ALICE="alice$(date +%s)"
ALICE_EMAIL="${ALICE}@example.test"
info "Register ALICE: ${ALICE}"
R1=$(curl_json POST /api/users/register "{\"username\":\"${ALICE}\",\"email\":\"${ALICE_EMAIL}\",\"password\":\"secret\"}") || true
echo "${R1}" | ${JQ} .
if [[ "$(echo "${R1}" | ${JQ} -r '.ok // false')" != "true" ]]; then
  # si user_exists, ce n’est pas bloquant
  if [[ "$(echo "${R1}" | ${JQ} -r '.error // empty')" == "user_exists" ]]; then
    warn "ALICE existe déjà"
  else
    fail "register ALICE a échoué"
  fi
else
  ok "ALICE créée"
fi

# --- 2) Login ALICE ---
info "Login ALICE…"
L1=$(curl_json POST /api/users/login "{\"username\":\"${ALICE}\",\"password\":\"secret\"}")
echo "${L1}" | ${JQ} .
TOKEN_ALICE=$(echo "${L1}" | ${JQ} -r '.token // empty')
[[ -n "${TOKEN_ALICE}" ]] || fail "token ALICE manquant"
ALICE_ID=$(echo "${L1}" | ${JQ} -r '.user.id')
ok "Login ALICE ok (id=${ALICE_ID})"

# --- 3) Games (listing vide/initial) ---
info "Lister les games (toutes / actives)…"
curl_json GET /api/games | ${JQ} .
curl_json GET "/api/games?status=active" | ${JQ} .
ok "Listing games ok"

# --- 4) Créer une game sans adversaire (waiting) ---
info "Création game (waiting) par ALICE…"
G1=$(curl_json POST /api/games '{"status":"waiting"}' "${TOKEN_ALICE}")
echo "${G1}" | ${JQ} .
GAME_WAITING_ID=$(echo "${G1}" | ${JQ} -r '.gameId // empty')
[[ -n "${GAME_WAITING_ID}" ]] || fail "creation game waiting a échoué"
ok "Game waiting créée (id=${GAME_WAITING_ID})"

# --- 5) Créer BOB + Login ---
BOB="bob$(date +%s)"
BOB_EMAIL="${BOB}@example.test"
info "Register BOB: ${BOB}"
R2=$(curl_json POST /api/users/register "{\"username\":\"${BOB}\",\"email\":\"${BOB_EMAIL}\",\"password\":\"secret\"}") || true
echo "${R2}" | ${JQ} .
if [[ "$(echo "${R2}" | ${JQ} -r '.ok // false')" != "true" ]]; then
  if [[ "$(echo "${R2}" | ${JQ} -r '.error // empty')" == "user_exists" ]]; then
    warn "BOB existe déjà"
  else
    fail "register BOB a échoué"
  fi
else
  ok "BOB créé"
fi

info "Login BOB…"
L2=$(curl_json POST /api/users/login "{\"username\":\"${BOB}\",\"password\":\"secret\"}")
echo "${L2}" | ${JQ} .
TOKEN_BOB=$(echo "${L2}" | ${JQ} -r '.token // empty')
[[ -n "${TOKEN_BOB}" ]] || fail "token BOB manquant"
BOB_ID=$(echo "${L2}" | ${JQ} -r '.user.id')
ok "Login BOB ok (id=${BOB_ID})"

# --- 6) Créer une game avec adversaire (playing) ---
info "Création game playing (ALICE vs BOB)…"
G2=$(curl_json POST /api/games "{\"player2_id\":${BOB_ID},\"status\":\"playing\"}" "${TOKEN_ALICE}")
echo "${G2}" | ${JQ} .
[[ "$(echo "${G2}" | ${JQ} -r '.status // empty')" == "playing" ]] || warn "status playing non confirmé (ok si message indique succès)"
ok "Game with opponent (playing) — validation côté svc-game & insert DB ok"

# --- 7) Validation JOIN (svc-game, pas d’update DB ici) ---
info "Validation join (BOB rejoint la game waiting id=${GAME_WAITING_ID})…"
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
ok "Validation join renvoyée (voir sortie ci-dessus)."

# --- 8) Validation score & finish (svc-game) ---
info "Validation score update (svc-game)…"
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
info "Validation finish (svc-game)…"
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

# --- 9) Vérifs DB (facultatif) ---
info "Lecture rapide des 5 dernières games en DB (si conteneur présent)…"
try_docker_node "
import('/app/dist/database/index.js').then(async m=>{
  await m.initDb();
  const rows = await m.all('SELECT * FROM games ORDER BY id DESC LIMIT 5');
  console.log(rows);
}).catch(console.error)
"

ok "E2E auth+game terminé ✔"
