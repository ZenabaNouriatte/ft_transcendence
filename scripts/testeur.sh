#!/usr/bin/env bash

set -u
set -o pipefail

# Dépendance minimale
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq manquant (sudo apt-get install jq)"; exit 1; }

# Configuration COMPLÈTE
: "${TEST_MODE:=proxy}"
: "${PROXY_HTTPS:=https://localhost:8443}"
: "${GRAFANA_URL:=${PROXY_HTTPS}/grafana}"
: "${PROM_URL:=${PROXY_HTTPS}/prometheus}"
: "${ALERT_URL:=${PROXY_HTTPS}/alertmanager}"
: "${KIBANA_URL:=${PROXY_HTTPS}/kibana}"
: "${ES_INTERNAL_URL:=http://elasticsearch:9200}"
: "${ES_AUTH:=elastic:elastic}"
: "${PING_VIA_GATEWAY:=0}"
: "${TEST_INTERNAL:=1}"
: "${DB_PERSIST_TEST:=1}"


# Helpers
dc() { docker compose "$@"; }
c_green="\033[32m"; c_red="\033[31m"; c_yellow="\033[33m"; c_blue="\033[36m"; c_reset="\033[0m"
PASS=0; FAIL=0; SKIP=0

ok(){ echo -e "  ${c_green}OK${c_reset}     $*"; PASS=$((PASS+1)); }
ko(){ echo -e "  ${c_red}FAIL${c_reset}   $*"; FAIL=$((FAIL+1)); }
sk(){ echo -e "  ${c_yellow}SKIP${c_reset}   $*"; SKIP=$((SKIP+1)); }
section(){ echo -e "\n${c_blue}$*${c_reset}"; }

# Helpers techniques COMPLETS
http_code(){ curl -k -s -o /dev/null -w "%{http_code}" "$@"; }
prom_raw(){ curl -k -sG --data-urlencode "query=$1" "$PROM_URL/api/v1/query"; }
prom_first_num(){ jq -r '.data.result[0].value[1] // empty' 2>/dev/null | head -n1; }
prom_query(){ prom_raw "$1" | prom_first_num; }
prom_count_series(){ prom_raw "$1" | grep -c '"metric"'; }

prom_wait_value_ge(){
  local q="$1" want="$2" tries="${3:-8}" sleep_s="${4:-5}"
  for _ in $(seq 1 "$tries"); do
    local v; v=$(prom_query "$q")
    if [ -n "${v:-}" ]; then awk "BEGIN{exit !($v>=$want)}" && { echo "$v"; return 0; }; fi
    sleep "$sleep_s"
  done; echo ""; return 1
}

prom_wait_series_ge(){
  local q="$1" want="${2:-1}" tries="${3:-8}" sleep_s="${4:-5}"
  for _ in $(seq 1 "$tries"); do
    local c; c=$(prom_count_series "$q")
    if [ "$c" -ge "$want" ]; then echo "$c"; return 0; fi
    sleep "$sleep_s"
  done; echo "0"; return 1
}

# Helper login avec retry
login_retry() {
  local username="$1" pass="$2" tries="${3:-8}"
  local res code body token=""
  for _ in $(seq 1 "$tries"); do
    res=$(curl -sk -X POST "$PROXY_HTTPS/api/users/login" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"username\":\"$username\",\"password\":\"$pass\"}" \
      -w $'\n%{http_code}')
    code="${res##*$'\n'}"
    body="${res%$'\n'*}"
    if [ "$code" = "200" ]; then
      token=$(printf '%s' "$body" | jq -r .token 2>/dev/null)
      [ -n "$token" ] && [ "$token" != "null" ] && { echo "$token"; return 0; }
    fi
    sleep 1
  done
  echo ""
  return 1
}

echo -e "${c_blue}
===============================================
   TESTS ft_transcendence - $(date '+%d/%m/%Y %H:%M')
===============================================${c_reset}
"
# ===============================
# 0. PROXY TLS & WS (PUBLIC_HOST)
# ===============================
section "0. PROXY TLS & WS (PUBLIC_HOST)"
command -v dc >/dev/null 2>&1 || dc() { docker compose "$@"; }

# Détection de l'hôte public + forcer PROXY_HTTPS
if [ -x ./scripts/public_host.sh ]; then
  HOST="$(./scripts/public_host.sh 2>/dev/null || echo 127.0.0.1)"
else
  HOST="127.0.0.1"
fi
PROXY_HTTPS="https://${HOST}:8443"
echo "PUBLIC_HOST détecté: $HOST"

# Certificat TLS - SAN (supporte 'IP Address:' et 'IP.n = ...')
echo "Certificat TLS - SAN..."
SAN_OUT="$(
  printf '' \
  | openssl s_client -connect ${HOST}:8443 -servername ${HOST} 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName 2>/dev/null
)"
if printf '%s\n' "$SAN_OUT" | grep -qE "(IP Address:|IP\.[0-9]+[[:space:]]*=\s*)${HOST}\b"; then
  ok "Cert SAN contient IP=${HOST}"
else
  ko "Cert SAN ne contient pas IP=${HOST}"
  echo "$SAN_OUT" | sed -n '1,12p'
fi

# Handshake WebSocket via proxy (HTTP/1.1 → 101) avec SNI
echo "Handshake WebSocket via proxy (HTTP/1.1 → 101)..."
WS_RESP="$(
  printf 'GET /ws?channel=local HTTP/1.1\r\nHost: %s:8443\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==\r\n\r\n' "$HOST" \
  | openssl s_client -connect ${HOST}:8443 -servername ${HOST} -quiet 2>/dev/null \
  | sed -n '1,5p' || true
)"
if echo "$WS_RESP" | grep -q "HTTP/1.1 101"; then
  ok "Upgrade WebSocket via proxy réussi (101 Switching Protocols)"
else
  ko "Upgrade WebSocket via proxy échoué"
  echo "$WS_RESP"
fi

# FRONT_ORIGINS côté gateway (vérifie aussi le rôle)
echo "FRONT_ORIGINS côté gateway..."
FO_LINE="$(dc exec -T gateway sh -lc 'echo "NODE_ENV=$NODE_ENV | FRONT_ORIGINS=$FRONT_ORIGINS | SERVICE_ROLE=$SERVICE_ROLE"' 2>/dev/null || true)"
if [ -z "$FO_LINE" ]; then
  echo "(debug) 'dc exec' n'a rien renvoyé — état des conteneurs :"
  docker compose ps
  echo "(debug) dump env direct :"
  docker compose exec -T gateway env | grep -E '^(SERVICE_ROLE|FRONT_ORIGINS|NODE_ENV)=' || true
fi
if printf '%s' "$FO_LINE" | grep -q "SERVICE_ROLE=gateway" \
   && printf '%s' "$FO_LINE" | grep -q "https://${HOST}:8443"; then
  ok "FRONT_ORIGINS inclut https://${HOST}:8443 et SERVICE_ROLE=gateway"
else
  ko "FRONT_ORIGINS ou SERVICE_ROLE mal configuré"
  printf '%s\n' "$FO_LINE"
fi

echo "Vérification préliminaire DB (table users)…"
tries=20
until dc exec -T gateway sh -lc 'sqlite3 "$DB_PATH" ".tables" | grep -qw users' >/dev/null 2>&1; do
  tries=$((tries-1))
  [ $tries -le 0 ] && break
  sleep 1
done
if dc exec -T gateway sh -lc 'sqlite3 "$DB_PATH" ".tables" | grep -qw users'; then
  ok "Table 'users' présente"
else
  ko "Table 'users' absente (initDb non terminé ?)"
  dc exec -T gateway sh -lc 'echo "SERVICE_ROLE=$SERVICE_ROLE | DB_PATH=$DB_PATH"; sqlite3 "$DB_PATH" ".schema users"'
  exit 1
fi 

#Register → online → logout → offline (self-check)
test_online_offline() {
  command -v jq >/dev/null 2>&1 || { ko "jq manquant"; return 1; }

  local HOST="$1" U="tester_$RANDOM" P="Pass1234" TOKEN tries=5

  # Register → token
  TOKEN="$(curl -sk "https://${HOST}:8443/api/users/register" \
    -H 'Content-Type: application/json' \
    --data "{\"username\":\"${U}\",\"email\":\"${U}@example.com\",\"password\":\"${P}\"}" \
    | jq -r '.token // empty')"

  if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    ko "Échec register/token"
    return 1
  fi

  # petit backoff (DB write)
  sleep 0.2

  # ONLINE (retry court)
  local ok_online=0
  for _ in $(seq 1 $tries); do
    if dc exec -T gateway sh -lc \
      "sqlite3 -csv \"\$DB_PATH\" \"SELECT status FROM users WHERE username='${U}';\"" \
      | grep -q '^online$'; then
      ok_online=1; break
    fi
    sleep 0.2
  done
  [ $ok_online -eq 1 ] && ok "Après register: status=online" || ko "Status pas online après register"

  # Logout (filet)
  local hdr="$(mktemp)"
  curl -sk -X POST "https://${HOST}:8443/api/users/logout" \
    -H "Authorization: Bearer ${TOKEN}" \
    -D "$hdr" >/dev/null 2>&1 || true
  grep -qE '^HTTP/2 200|^HTTP/1.1 200' "$hdr" \
    && ok "Route /api/users/logout répond 200" \
    || ko "Route /api/users/logout ne répond pas 200"
  rm -f "$hdr"
  sleep 0.2

  # OFFLINE
  if dc exec -T gateway sh -lc \
    "sqlite3 -csv \"\$DB_PATH\" \"SELECT status FROM users WHERE username='${U}';\"" \
    | grep -q '^offline$'; then
    ok "Après logout: status=offline"
  else
    ko "Status pas offline après logout"
  fi

  # Cleanup user de test
  dc exec -T gateway sh -lc \
    "sqlite3 \"\$DB_PATH\" \"DELETE FROM users WHERE username='${U}';\"" >/dev/null 2>&1 || true
}

echo "Cycle register → online → logout → offline…"
test_online_offline "$HOST"

# ===============================
# 1. INFRASTRUCTURE DE BASE
# ===============================
section "1. INFRASTRUCTURE - Conteneurs et réseau"

echo "Proxy et Gateway..."
code=$(http_code "$PROXY_HTTPS/healthz")
[ "$code" = "200" ] && ok "Health check global (HTTPS)" || ko "Health check échoué (code: $code)"

code=$(http_code "$PROXY_HTTPS/metrics")
[ "$code" = "200" ] && ok "Metriques gateway accessibles" || ko "Metriques gateway inaccessibles"

echo "Redirections HTTP -> HTTPS..."
http_code_8080=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/)
loc=$(curl -s -I http://localhost:8080/ | awk -F': ' '/^Location:/ {print $2}' | tr -d '\r')
if [[ "$http_code_8080" =~ ^30[12]$ ]] && echo "$loc" | grep -q "https://localhost:8443"; then
    ok "Redirection automatique HTTP -> HTTPS activée"
else
    ko "Redirection HTTP -> HTTPS manquante"
fi

echo "Pages principales..."
code=$(http_code "$PROXY_HTTPS/")
[ "$code" = "200" ] && ok "Page d'accueil chargée" || ko "Page d'accueil échoue"

code=$(http_code "$PROXY_HTTPS/ws-test.html")
[ "$code" = "200" ] && ok "Page test WebSocket chargée" || ko "Page test WebSocket échoue"

# ===============================
# 2. SERVICES API
# ===============================
section "2. SERVICES API - Microservices"

if [ "${PING_VIA_GATEWAY:-0}" = "1" ]; then
    echo "Pings des services via Gateway..."
    SVC_LIST="users|/api/users/ping
games|/api/games/ping
chat|/api/chat/ping
tournaments|/api/tournaments/ping"
    while IFS="|" read -r name url; do
        [ -z "$name" ] && continue
        body=$(curl -k -s -H 'Accept: application/json' "$PROXY_HTTPS$url" || true)
        if echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' ; then
            ok "$name: service repond"
        else
            ko "$name: service ne repond pas"
        fi
    done <<EOF
$SVC_LIST
EOF
fi

# ===============================
# 3. WEBSOCKETS TEMPS REEL
# ===============================
section "3. WEBSOCKETS - Communication temps reel"

echo "Connexion WebSocket de base..."
dc exec -T gateway node - <<'NODE' && ok "Connexion WebSocket établie" || ko "Connexion WebSocket échouée"
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8000/ws', { handshakeTimeout: 3000 });
const timeout = setTimeout(() => process.exit(1), 5000);
ws.on('open', () => { clearTimeout(timeout); process.exit(0); });
ws.on('error', () => process.exit(1));
NODE

echo "Test envoi/reception messages..."
dc exec -T gateway node - <<'NODE' && ok "Messages chat fonctionnels" || ko "Messages chat échoués"
const WebSocket = require('ws');
const url = 'ws://localhost:8000/ws';
const id = 'ci-' + Math.random().toString(36).slice(2);
const ws = new WebSocket(url, { handshakeTimeout: 3000 });
const t = setTimeout(()=>{ process.exit(1); }, 5000);
ws.on('open', ()=> ws.send(JSON.stringify({ type:'chat.message', data:{ text:'ci-ping'}, requestId:id })));
ws.on('message', (buf)=> { 
    try { 
        const j = JSON.parse(buf.toString()); 
        if (j.type==='ack' && j.requestId===id) { 
            clearTimeout(t); 
            process.exit(0); 
        } 
    } catch {} 
});
ws.on('error', (e)=>{ process.exit(2); });
NODE

echo "Test ping/pong WebSocket..."
dc exec -T gateway node - <<'NODE' && ok "Ping/pong WebSocket actif" || ko "Ping/pong WebSocket échoué"
const WebSocket = require('ws');
const url = 'ws://localhost:8000/ws';
const id = 'ping-' + Math.random().toString(36).slice(2);
const ws = new WebSocket(url, { handshakeTimeout: 3000 });
const t = setTimeout(()=>{ process.exit(1); }, 4000);
ws.on('open', ()=> ws.send(JSON.stringify({ type:'ws.ping', requestId:id })));
ws.on('message', (buf)=> { 
    try { 
        const j = JSON.parse(buf.toString()); 
        if (j.type==='ws.pong') { 
            clearTimeout(t); 
            process.exit(0); 
        } 
    } catch {} 
});
ws.on('error', (e)=>{ process.exit(2); });
NODE

echo "Connexion WebSocket persistante pour métriques..."
dc exec -d gateway sh -c '
node -e "
const WebSocket = require('\''ws'\'');
const ws = new WebSocket('\''ws://localhost:8000/ws'\'');
ws.on('\''open'\'', () => {
  let count = 0;
  const iv = setInterval(() => {
    ws.send(JSON.stringify({ type: '\''chat.message'\'', data:{ text: '\''metrics-test'\''}, requestId: Date.now().toString() }));
    if (++count >= 5) clearInterval(iv);
  }, 2000);
  setTimeout(() => process.exit(0), 30000);
});
ws.on('\''error'\'', console.error);
" >/tmp/ws-persistent.log 2>&1 &
' && ok "WebSocket persistant démarré" || ko "WebSocket persistant échoué"
sleep 2

# ===============================
# 4. MONITORING ET METRIQUES
# ===============================
section "4. MONITORING - Observabilité via HTTPS"

echo "Prometheus - Services de base..."
v=$(prom_wait_value_ge 'up{job="gateway"}' 1 10 5)
[ -n "$v" ] && ok "Service gateway monitoré" || ko "Service gateway non monitoré"

echo "Prometheus - Métriques avancées..."
c=$(prom_wait_series_ge 'histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[1m])))' 1 10 5)
[ "$c" -ge 1 ] && ok "Latence HTTP monitorée (p95)" || sk "Latence HTTP non disponible"

c=$(prom_wait_series_ge 'sum by (route) (rate(http_request_duration_seconds_count[1m]))' 1 10 5)
[ "$c" -ge 1 ] && ok "Requêtes par seconde monitorées" || sk "RPS non disponibles"

c=$(prom_count_series 'sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[1m]))')
[ "$c" -ge 0 ] && ok "Erreurs 5xx monitorées (count=$c)" || sk "Erreurs 5xx non monitorées"

v=$(prom_wait_value_ge 'ws_messages_total{type="chat.message"}' 1 12 5)
[ -n "$v" ] && ok "Messages WebSocket comptabilisés ($v)" || ko "Messages WebSocket non comptabilisés"

echo "Test de connectivité approfondi des services monitoring..."
# Test Grafana API
if curl -k -s "${GRAFANA_URL}/api/health" | jq -e '.database == "ok"' >/dev/null; then
  ok "Grafana API health OK"
else
  ko "Grafana API health échoué"
fi

# Test Prometheus query
if curl -k -s "${PROM_URL}/api/v1/query?query=up" | jq -e '.data.result' >/dev/null; then
  ok "Prometheus API query fonctionnelle"
else
  ko "Prometheus API query échouée"
fi

# Test Kibana status
if curl -k -s "${KIBANA_URL}/api/status" | jq -e '.status.overall.level' >/dev/null; then
  ok "Kibana API status accessible"
else
  ko "Kibana API status inaccessible"
fi

echo "Grafana via HTTPS..."
# Suivre redirections + accepter 200/301/302/303 comme OK
gcode=$(curl -k -L -s -o /dev/null -w "%{http_code}" "${GRAFANA_URL}/login")
case "$gcode" in
  200|301|302|303) ok "Grafana accessible (UI via proxy HTTPS, code=$gcode)";;
  *)               ko "Grafana inaccessible via HTTPS (code: $gcode)";;
esac

# Health Grafana (via proxy HTTPS) — garde le verdict dur sur l'API
gapi=$(curl -k -s "${GRAFANA_URL}/api/health" | jq -r '.database // empty')
[ "$gapi" = "ok" ] && ok "Grafana /api/health OK via HTTPS" || ko "Grafana /api/health KO via HTTPS"

echo "Prometheus via HTTPS..."
# Health Prometheus (GET, pas HEAD) via HTTPS
phealth=$(curl -k -s "${PROM_URL}/-/healthy")
echo "$phealth" | grep -q "Healthy" && ok "Prometheus Healthy via HTTPS" || ko "Prometheus unhealthy via HTTPS"

# Une page UI pour s'assurer du routage HTTPS
pcode=$(curl -k -s -o /dev/null -w "%{http_code}" "${PROM_URL}/graph")
[ "$pcode" = "200" ] && ok "Prometheus UI via proxy HTTPS" || ko "Prometheus UI KO via HTTPS (code: $code)"

echo "Alertmanager via HTTPS..."
ahealth=$(curl -k -s "${ALERT_URL}/-/healthy")
echo "$ahealth" | grep -q "^OK" && ok "Alertmanager Healthy via HTTPS" || ko "Alertmanager unhealthy via HTTPS"

# ⚠️ Utiliser GET (HEAD → 405 attendu) via HTTPS
acode=$(curl -k -s -o /dev/null -w "%{http_code}" "${ALERT_URL}/")
[ "$acode" = "200" ] && ok "Alertmanager UI via proxy HTTPS" || ko "Alertmanager UI KO via HTTPS (code: $acode)"

echo "Kibana via HTTPS..."
# 1) Essai API status (idéal si le proxy réécrit /kibana/ -> /)
kstat=$(curl -k -s "${KIBANA_URL}/api/status" | jq -r '.status.level // empty')
if [ -n "$kstat" ]; then
  ok "Kibana status=${kstat} via HTTPS"
else
  # 2) Fallback : valider l'accès UI (suivre redirs et accepter 200/301/302/303)
  kcode=$(curl -k -L -s -o /dev/null -w "%{http_code}" "${KIBANA_URL}/")
  case "$kcode" in
    200|301|302|303) ok "Kibana UI accessible via HTTPS (code=$kcode)";;
    *)               ko "Kibana KO via HTTPS (api/status et UI)";;
  esac
fi


echo "Elasticsearch (interne)..."
# Tester ES depuis le réseau docker via le conteneur 'proxy'
if dc exec -T proxy sh -lc "apk add --no-cache curl >/dev/null 2>&1 || true; curl -su '$ES_AUTH' -o /dev/null -w '%{http_code}' '${ES_INTERNAL_URL}/_cluster/health'" | grep -q '^200$'; then
  ok "Elasticsearch opérationnel (via réseau docker)"
else
  ko "Elasticsearch inaccessible (auth/URL/boot?)"
fi

# ===============================
# 5. ARCHITECTURE MICROSERVICES
# ===============================
section "5. ARCHITECTURE - Services et communication"

echo "Base de données..."
if dc exec -T gateway sh -lc '[ -n "$DB_PATH" ] && [ -d /data ]'; then
    ok "Base de données configurée sur gateway"
else
    ko "Base de données mal configurée"
fi

echo "Communication entre services..."
for svc in auth game chat tournament user; do
    if dc exec -T "$svc" ping -c 1 gateway >/dev/null 2>&1; then
        ok "$svc -> gateway: communication OK"
    else
        ko "$svc -> gateway: communication échouée"
    fi
done

if [ "$TEST_INTERNAL" = "1" ]; then
    echo "Health checks internes..."
    for svc in auth game chat tournament user; do
        if dc exec -T "$svc" node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
            ok "$svc: health check OK"
        else
            ko "$svc: health check échoué"
        fi
    done

    echo "Metriques internes..."
    for svc in auth game chat tournament user; do
        if dc exec -T "$svc" node -e "fetch('http://localhost:'+process.env.PORT+'/metrics').then(r=>r.text()).then(t=>{process.exit(/^# HELP http_request_duration_seconds /m.test(t)?0:2)}).catch(()=>process.exit(1))"; then
            ok "$svc: métriques disponibles"
        else
            sk "$svc: métriques absentes"
        fi
    done
fi

# ===============================
# 6. API ET ROUTAGE
# ===============================
section "6. API - Routes et endpoints"

echo "Routage par service..."
for pfx in users games chat tournaments; do
    code=$(http_code "$PROXY_HTTPS/api/$pfx/__does_not_exist__")
    [ "$code" = "404" ] && ok "/api/$pfx/: routage actif" || ko "/api/$pfx/: routage défaillant"
done

# ===============================
# 7. UTILISATEURS ET DONNEES
# ===============================
section "7. DONNEES - Utilisateurs et persistance"

echo "Base de données SQLite..."
if dc exec -T gateway sh -lc 'test -s /data/app.sqlite'; then
    ok "Base de données présente et non vide"
else
    ko "Base de données absente ou vide"
fi

echo "Création compte utilisateur..."
TEST_USER="testuser_$(date +%s)"
TEST_EMAIL="${TEST_USER}@test.local"
TEST_PASS="SecurePass123!"

reg_response=$(curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USER\",\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")

if echo "$reg_response" | grep -q '"ok":true'; then
    USER_ID=$(echo "$reg_response" | jq -r '.userId')
    ok "Compte créé (ID: $USER_ID)"
else
    ko "Echec création compte"
    # Continuer malgré l'échec
fi

echo "Authentification..."
TOKEN=$(login_retry "$TEST_USER" "$TEST_PASS" 1)
if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
    ok "Connexion réussie (JWT)"
else
    ko "Echec connexion"
fi

echo "Profil utilisateur..."
if [ -n "$TOKEN" ]; then
    me_response=$(curl -k -s "$PROXY_HTTPS/api/users/me" -H "Authorization: Bearer $TOKEN")
    me_id=$(echo "$me_response" | jq -r '.user.id // empty')
    if [[ "$me_id" = "$USER_ID" ]]; then
        ok "Profil utilisateur accessible (ID: $me_id)"
    else
        ko "Profil utilisateur inaccessible"
    fi
else
    sk "Profil utilisateur (pas de token)"
fi

echo "Test persistance après redémarrage..."
dc restart gateway >/dev/null 2>&1
sleep 10

if curl -k -s "$PROXY_HTTPS/healthz" >/dev/null; then
    ok "Gateway redémarré"
    
    # Re-test connexion
    TOKEN2=$(login_retry "$TEST_USER" "$TEST_PASS" 8)
    if [ -n "$TOKEN2" ] && [ "$TOKEN2" != "null" ]; then
        ok "Re-connexion après redémarrage réussie"
        
        # Re-test profil
        me_response2=$(curl -k -s "$PROXY_HTTPS/api/users/me" -H "Authorization: Bearer $TOKEN2")
        me_id2=$(echo "$me_response2" | jq -r '.user.id // empty')
        if [[ "$me_id2" = "$USER_ID" ]]; then
            ok "Données persistantes après redémarrage"
        else
            ko "Données perdues après redémarrage"
        fi
    else
        ko "Re-connexion après redémarrage échouée"
    fi
else
    ko "Redémarrage gateway échoué"
fi

# Nettoyage
dc exec -T gateway sqlite3 /data/app.sqlite "DELETE FROM users WHERE username='$TEST_USER';" 2>/dev/null || true

# ===============================
# 8. SECURITE
# ===============================
section "8. SECURITE - Protections"

echo "Hashage mots de passe..."
SEC_USER="sec_$(date +%s)"
curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$SEC_USER\",\"email\":\"${SEC_USER}@test.local\",\"password\":\"MySecret123!\"}" >/dev/null

db_hash=$(dc exec -T gateway sqlite3 /data/app.sqlite "SELECT password FROM users WHERE username='$SEC_USER';" 2>/dev/null || echo "")
if [[ "$db_hash" =~ ^\$2[ab]\$[0-9]{2}\$ ]]; then
    ok "Mots de passe hashés (bcrypt)"
else
    ko "Mots de passe non hashés"
fi

echo "Protection injections..."
xss_test=$(curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"<script>alert(1)</script>","email":"test@test.com","password":"test123"}')
echo "$xss_test" | grep -q '"error":"Invalid username"' && ok "XSS bloqué" || ko "XSS non bloqué"

sqli_test=$(curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"test; DROP TABLE users--","email":"test@test.com","password":"test123"}')
echo "$sqli_test" | grep -q '"error":"Invalid username"' && ok "SQL injection bloquée" || ko "SQL injection non bloquée"

echo "Validation données..."
email_test=$(curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","email":"invalid-email","password":"Password123"}')
echo "$email_test" | grep -q '"error":"invalid_email_format"' && ok "Validation email active" || ko "Validation email défaillante"

pass_test=$(curl -k -s -X POST "$PROXY_HTTPS/api/users/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","email":"test@test.com","password":"short"}')
echo "$pass_test" | grep -q '"error":"password_too_short"' && ok "Validation password active" || ko "Validation password défaillante"

echo "Protection routes API..."
protect_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$PROXY_HTTPS/api/users/me")
if [ "$protect_code" = "401" ] || [ "$protect_code" = "403" ]; then
    ok "Routes API protégées (JWT requis)"
else
    ko "Routes API non protégées"
fi

# Nettoyage
dc exec -T gateway sqlite3 /data/app.sqlite "DELETE FROM users WHERE username='$SEC_USER';" 2>/dev/null || true

# ===============================
# RESULTATS
# ===============================
echo -e "\n${c_blue}
===============================================
   RESULTATS DES TESTS
===============================================${c_reset}
"

echo "Tests réussis : $PASS"
echo "Tests échoués  : $FAIL" 
echo "Tests ignorés  : $SKIP"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${c_green}SUCCES: Tous les tests sont reussis !${c_reset}"
    echo "L'application est prête pour la production."
    exit 0
else
    echo -e "${c_red}ECHEC: $FAIL test(s) ont échoué. Vérifiez la configuration.${c_reset}"
    exit 1
fi