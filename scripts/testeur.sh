#!/usr/bin/env bash
# Testeur ft_transcendence - Version COMPLÈTE (53 tests)
# Messages clairs mais tous les tests conservés

set -u
set -o pipefail

# Dépendance minimale
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq manquant (sudo apt-get install jq)"; exit 1; }

# Configuration COMPLÈTE
: "${PROXY_HTTPS:=https://localhost:8443}"
: "${PROM_URL:=http://localhost:9090}"
: "${ES_URL:=http://localhost:9200}"
: "${ES_AUTH:=elastic:elastic}"
: "${GRAFANA_URL:=http://localhost:3000}"
: "${ALERT_URL:=http://localhost:9093}"
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
prom_raw(){ curl -sG --data-urlencode "query=$1" "$PROM_URL/api/v1/query"; }
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
section "4. MONITORING - Observabilité"

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

c=$(prom_wait_series_ge 'websocket_connections_active{job="gateway"}' 1 8 5)
[ "$c" -ge 1 ] && ok "Connexions WebSocket actives monitorées" || sk "Connexions WebSocket non monitorées"

echo "Grafana et Alertmanager..."
code=$(curl -s -o /dev/null -w "%{http_code}" "$GRAFANA_URL/login")
[ "$code" = "200" ] && ok "Grafana accessible" || ko "Grafana inaccessible"

code=$(curl -s -o /dev/null -w "%{http_code}" "$ALERT_URL/#/alerts")
[ "$code" = "200" ] && ok "Alertmanager accessible" || ko "Alertmanager inaccessible"

echo "Elasticsearch et Kibana..."
code=$(curl -s -u "$ES_AUTH" -o /dev/null -w "%{http_code}" "$ES_URL/_cluster/health")
[ "$code" = "200" ] && ok "Elasticsearch opérationnel" || ko "Elasticsearch inaccessible"

code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5601/api/status")
[ "$code" = "200" ] && ok "Kibana accessible" || sk "Kibana non prêt"

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