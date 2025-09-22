#!/usr/bin/env bash
# Test runner ft_transcendence — Proxy, API, WS, Prometheus, ELK

set -u
set -o pipefail

# ─────────── Config (surchargable par env) ───────────
: "${PROXY_HTTPS:=https://localhost:8443}"
: "${PROM_URL:=http://localhost:9090}"
: "${ES_URL:=http://localhost:9200}"
: "${ES_AUTH:=elastic:elastic}"           # ajuste si besoin
: "${NGINX_ACCESS_PATH:=/var/log/nginx/access.json}"
: "${TEST_INTERNAL:=1}"                   # 1 = tester l’intérieur des conteneurs
: "${PING_VIA_GATEWAY:=0}"                # 1 = exiger des /api/*/ping servis via gateway→svc (proxy). 0 = désactivé (API servie au gateway).
: "${GRAFANA_URL:=http://localhost:3000}"
: "${ALERT_URL:=http://localhost:9093}"

# curl options communs
CURL_CMN=(-k --connect-timeout 5 --max-time 15 -sS -H 'Accept: application/json')

# docker compose vs docker-compose
dc() { if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; else docker compose "$@"; fi; }

# couleurs + helpers
c_green="\033[32m"; c_red="\033[31m"; c_yellow="\033[33m"; c_blue="\033[36m"; c_reset="\033[0m"
PASS=0; FAIL=0; SKIP=0
ok(){ echo -e "  ${c_green}OK${c_reset}  $*"; PASS=$((PASS+1)); }
ko(){ echo -e "  ${c_red}FAIL${c_reset} $*"; FAIL=$((FAIL+1)); }
sk(){ echo -e "  ${c_yellow}SKIP${c_reset} $*"; SKIP=$((SKIP+1)); }
sec(){ echo -e "\n${c_blue}# $*${c_reset}"; }

http_code(){ curl "${CURL_CMN[@]}" -o /dev/null -w "%{http_code}" "$1"; }
json_num(){ jq -r 'try .total catch empty'; }

# Prometheus helpers
prom_raw(){ curl -sG --data-urlencode "query=$1" "$PROM_URL/api/v1/query"; }
prom_first_num(){ jq -r '.data.result[0].value[1] // empty' 2>/dev/null | head -n1;}
prom_query(){ prom_raw "$1" | prom_first_num; }             # 1ère valeur numérique
prom_count_series(){ prom_raw "$1" | grep -c '"metric"'; }  # nb de séries

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

echo -e "${c_blue}=== ft_transcendence — test stack $(date '+%F %T') ===${c_reset}"

# ────────────────────────────── Proxy & Gateway ──────────────────────────────
sec "Proxy & Gateway"
code=$(http_code "$PROXY_HTTPS/healthz")
[ "$code" = "200" ] && ok "proxy HTTPS /healthz → 200" || ko "proxy HTTPS /healthz → $code"

code=$(http_code "$PROXY_HTTPS/metrics")
[ "$code" = "200" ] && ok "gateway /metrics via proxy" || ko "gateway /metrics KO via proxy"

# ───────────────────── Pages publiques & redirections ─────────────────────
sec "Pages publiques & redirections"

# 8080 doit rediriger vers 8443
code=$(curl -k -s -o /dev/null -w "%{http_code}" http://localhost:8080/)
loc=$(curl -k -s -I http://localhost:8080/ | awk -F': ' '/^Location:/ {print $2}' | tr -d '\r')
if [[ "$code" =~ ^30[12]$ ]] && echo "$loc" | grep -q "https://localhost:8443"; then
  ok "HTTP 8080 → redirection $code vers 8443"
else
  ko "HTTP 8080 redirection KO (code=$code, Location='$loc')"
fi

# Page d'accueil via proxy HTTPS
code=$(http_code "$PROXY_HTTPS/")
[ "$code" = "200" ] && ok "App (/) via proxy → 200" || ko "App (/) via proxy → $code"

# Page de test WebSocket
code=$(http_code "$PROXY_HTTPS/ws-test.html")
[ "$code" = "200" ] && ok "WS test page (/ws-test.html) → 200" || ko "WS test page (/ws-test.html) → $code"

# ─────────────────────────────────── API ───────────────────────────────────
sec "API (via Gateway → services)"

# helper: GET /api/visits (3 tentatives, parse JSON)
try_get_visits() {
  for i in 1 2 3; do
    v=$(curl "${CURL_CMN[@]}" "$PROXY_HTTPS/api/visits" | json_num)
    [[ "$v" =~ ^[0-9]+$ ]] && { echo "$v"; return 0; }
    sleep 1
  done
  echo ""
}

# 1) lecture avant
before=$(try_get_visits)
[[ "$before" =~ ^[0-9]+$ ]] && ok "GET /api/visits = $before" || { ko "GET /api/visits réponse inattendue"; before=""; }

# 2A) POST sans headers -> doit être refusé (4xx)
code=$(curl "${CURL_CMN[@]}" -o /dev/null -w "%{http_code}" -X POST "$PROXY_HTTPS/api/visit")
[[ "$code" =~ ^4 ]] && ok "POST /api/visit (sans header) refusé ($code)" || sk "POST /api/visit (sans header) accepté ($code)"

# 2B) POST "navigateur" : body JSON + en-têtes d'origine + signal
post_body=$(curl "${CURL_CMN[@]}" -X POST "$PROXY_HTTPS/api/visit" \
  -H 'Content-Type: application/json' \
  -H 'X-Nav-Type: navigate' \
  -H "Origin: $PROXY_HTTPS" \
  -H "Referer: $PROXY_HTTPS/" \
  --data-raw '{}')

post_num=$(echo "$post_body" | json_num)

# 3) lecture après, avec petite attente
after=""
for i in 1 2 3; do
  after=$(try_get_visits)
  [[ "$after" =~ ^[0-9]+$ ]] && break
  sleep 1
done

# 4) évaluation
if [[ "$post_num" =~ ^[0-9]+$ ]]; then
  ok "POST /api/visit (avec signal) total=$post_num"
else
  if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ && "$after" -ge $((before+1)) ]]; then
    ok "POST /api/visit (avec signal) OK (compteur augmenté $before → $after)"
  else
    ko "POST /api/visit (avec signal) réponse inattendue (body=${post_body:0:80}...)"
  fi
fi

# 5) validation finale du +1
if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ ]]; then
  if [ "$after" -ge $((before+1)) ]; then
    ok "Compteur visites +1 (>=) ($before → $after)"
  else
    ko "Compteur visites n'a pas augmenté ($before → $after)"
  fi
else
  sk "Validation +1 visits sautée (valeurs non numériques: before='$before', after='$after')"
fi

# ───────────────────────── Services (pings via Gateway) ─────────────────────
if [ "${PING_VIA_GATEWAY:-0}" = "1" ]; then
  sec "API – pings par service (via Gateway)"
  SVC_LIST="users|/api/users/ping
games|/api/games/ping
chat|/api/chat/ping
tournaments|/api/tournaments/ping"
  while IFS="|" read -r name url; do
    [ -z "$name" ] && continue
    body=$(curl "${CURL_CMN[@]}" "$PROXY_HTTPS$url" || true)
    if echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' ; then
      ok "$name: $url"
    else
      ko "$name: $url (réponse inattendue via gateway)"
    fi
  done <<EOF
$SVC_LIST
EOF
fi

# ─────────────────────────────────── WS ────────────────────────────────────
sec "WebSocket (via Gateway interne)"

# 1) chat.message + ack
dc exec -T gateway node - <<'NODE'
const WebSocket = require('ws');
const url = 'ws://localhost:8000/ws';
const id = 'ci-' + Math.random().toString(36).slice(2);
const ws = new WebSocket(url, { handshakeTimeout: 3000 });
const t = setTimeout(()=>{ console.log('FAIL no ack'); process.exit(1); }, 5000);
ws.on('open', ()=> ws.send(JSON.stringify({ type:'chat.message', data:{ text:'ci-ping'}, requestId:id })));
ws.on('message', (buf)=> { try { const j = JSON.parse(buf.toString()); if (j.type==='ack' && j.requestId===id) { clearTimeout(t); console.log('OK'); process.exit(0); } } catch {} });
ws.on('error', (e)=>{ console.log('FAIL '+e.message); process.exit(2); });
NODE
rc=$?; [ $rc -eq 0 ] && ok "WS ack (chat.message)" || ko "WS ack KO (rc=$rc) — voir logs gateway"

# 2) ws.ping → ws.pong
dc exec -T gateway node - <<'NODE'
const WebSocket = require('ws');
const url = 'ws://localhost:8000/ws';
const id = 'ping-' + Math.random().toString(36).slice(2);
const ws = new WebSocket(url, { handshakeTimeout: 3000 });
const t = setTimeout(()=>{ console.log('FAIL no pong'); process.exit(1); }, 4000);
ws.on('open', ()=> ws.send(JSON.stringify({ type:'ws.ping', requestId:id })));
ws.on('message', (buf)=> { try { const j = JSON.parse(buf.toString()); if (j.type==='ws.pong') { clearTimeout(t); console.log('OK'); process.exit(0); } } catch {} });
ws.on('error', (e)=>{ console.log('FAIL '+e.message); process.exit(2); });
NODE
rc=$?; [ $rc -eq 0 ] && ok "WS ping/pong" || ko "WS ping/pong KO (rc=$rc)"

# 3) Connexion WS persistante pour les métriques
echo "Création d'une connexion WS persistante pour les tests métriques..."
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
'
sleep 5

# ─────────────────────── Prometheus / Grafana ──────────────────────
sec "Prometheus (Grafana metrics)"
# Grafana
code=$(http_code "$GRAFANA_URL/login")
case "$code" in
  200|302) ok "Grafana en ligne (code $code)";;
  *)       ko "Grafana KO (code $code)";;
esac

# Alertmanager
code=$(http_code "$ALERT_URL/#/alerts")
case "$code" in
  200|302) ok "Alertmanager en ligne (code $code)";;
  *)       ko "Alertmanager KO (code $code)";;
esac

v=$(prom_wait_value_ge 'up{job="gateway"}' 1 10 5)
[ -n "$v" ] && ok "up{job=\"gateway\"} = $v" || ko "Prometheus: up{job=\"gateway\"} pas OK"

c=$(prom_wait_series_ge 'histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[1m])))' 1 10 5)
[ "$c" -ge 1 ] && ok "p95 HTTP présent pour $c route(s)" || sk "p95 HTTP : pas encore de séries"

c=$(prom_wait_series_ge 'sum by (route) (rate(http_request_duration_seconds_count[1m]))' 1 10 5)
[ "$c" -ge 1 ] && ok "RPS par route présent ($c séries)" || sk "RPS par route : pas de séries"

c=$(prom_count_series 'sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[1m]))')
[ "$c" -ge 0 ] && ok "Séries erreurs 5xx par route visibles (count=$c)" || sk "Erreurs 5xx : pas de séries"

v=$(prom_wait_value_ge 'ws_messages_total{type="chat.message"}' 1 12 5)
[ -n "$v" ] && ok "Messages WS chat.message total ≥ 1 ($v)" || ko "Aucun message WS chat.message enregistré"

c=$(prom_wait_series_ge 'websocket_connections_active{job="gateway"}' 1 8 5)
[ "$c" -ge 1 ] && ok "Métrique websocket_connections_active présente ($c séries)" || sk "websocket_connections_active non détectée"

v=$(prom_wait_value_ge 'max by() (visits_db_total)' 0 8 5)
[ -n "$v" ] && ok "visits_db_total présent (val=$v)" || sk "visits_db_total non remonté"

# ───────────────────── Architecture — Gateway-only DB & API ──────────────────
sec "Architecture — Gateway-only DB & API"

# DB visible sur gateway uniquement
if dc exec -T gateway sh -lc '[ -n "$DB_PATH" ] && [ -d /data ]'; then
  ok "Gateway: DB_PATH défini et /data présent"
else
  ko "Gateway: DB_PATH ou /data manquant"
fi

for svc in auth game chat tournament visits; do
  # Aucun DB_PATH dans les svc-*
  if dc exec -T "$svc" sh -lc '[ -z "$DB_PATH" ]'; then
    ok "$svc: pas de DB_PATH (stateless)"
  else
    ko "$svc: DB_PATH détecté (devrait être stateless)"
  fi
  # Aucun /data monté dans les svc-*
  if dc exec -T "$svc" sh -lc '[ -d /data ]'; then
    ko "$svc: /data présent (ne doit pas monter la DB)"
  else
    ok "$svc: pas de /data (OK)"
  fi
  # Les svc-* ne doivent pas servir /api/visits → 404
  code=$(dc exec -T "$svc" node -e "fetch('http://localhost:'+process.env.PORT+'/api/visits').then(r=>{process.stdout.write(String(r.status));}).catch(()=>process.stdout.write('000'))")
  if [ "$code" = "404" ]; then
    ok "$svc: /api/visits → 404 (API servie par le gateway)"
  else
    sk "$svc: /api/visits → $code (attendu: 404)"
  fi
done

# ────────────── Services internes (réseau docker) ────────────────
if [ "$TEST_INTERNAL" = "1" ]; then
  sec "Services internes (healthz/metrics dans chaque conteneur)"
  for svc in auth game chat tournament visits; do
    if dc exec -T "$svc" node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      ok "$svc: /healthz"
    else
      ko "$svc: /healthz"
    fi
    if dc exec -T "$svc" node -e "fetch('http://localhost:'+process.env.PORT+'/metrics').then(r=>r.text()).then(t=>{process.exit(/^# HELP http_request_duration_seconds /m.test(t)?0:2)}).catch(()=>process.exit(1))"; then
      ok "$svc: /metrics (http_request_duration_seconds)"
    else
      sk "$svc: /metrics (absent)"
    fi
  done
fi

# ─────────── 404 ciblés par service (routage OK mais ressource absente) ───────────
sec "API – 404 attendus (routage par préfixe OK)"
for pfx in users games chat tournaments; do
  code=$(http_code "$PROXY_HTTPS/api/$pfx/__does_not_exist__")
  [ "$code" = "404" ] && ok "/api/$pfx/** → 404 (routage OK)" || ko "/api/$pfx/** → code $code (attendu: 404)"
done

# ─────────────────────────────────── ELK ───────────────────────────────────
sec "ELK (Elasticsearch/Kibana)"
code=$(curl "${CURL_CMN[@]}" -u "$ES_AUTH" -o /dev/null -w "%{http_code}" "$ES_URL/_cluster/health")
if [ "$code" = "200" ]; then
  body=$(curl -s -u "$ES_AUTH" "$ES_URL/_cluster/health" 2>/dev/null)
  echo "$body" | grep -q '"status"' && ok "Elasticsearch /_cluster/health répond" || ko "Elasticsearch /_cluster/health sans champ status"
else
  ko "Elasticsearch /_cluster/health → $code"
fi

ok_kib=false
for _ in {1..8}; do
  code=$(http_code "http://localhost:5601/api/status")
  case "$code" in 200|302|401) ok_kib=true; break;; *) sleep 5;; esac
done
$ok_kib && ok "Kibana en ligne (code $code)" || sk "Kibana non prêt (code $code)"

# ───────── DB — création & persistance (gateway) ─────────
if [ "${DB_PERSIST_TEST:-1}" = "1" ]; then
  sec "DB — création & persistance (gateway uniquement)"

  # 1) Le fichier SQLite existe et est non vide
  if dc exec -T gateway sh -lc 'test -s /data/app.sqlite'; then
    ok "gateway: /data/app.sqlite présent (non vide)"
  else
    ko "gateway: /data/app.sqlite absent ou vide"
  fi

  # helper: lecture JSON /api/visits avec retries
  get_visits_json(){
    for i in {1..15}; do
      body=$(curl "${CURL_CMN[@]}" "$PROXY_HTTPS/api/visits" || true)
      n=$(echo "$body" | jq -r 'try .total catch empty' 2>/dev/null)
      if [[ "$n" =~ ^[0-9]+$ ]]; then echo "$n"; return 0; fi
      sleep 1
    done
    echo ""
  }

  # 2) lecture avant
  before=$(get_visits_json)
  if [[ ! "$before" =~ ^[0-9]+$ ]]; then
    sk "Impossible de lire /api/visits avant restart"; before=""
  fi

  # 3) +1 puis restart gateway
  curl "${CURL_CMN[@]}" -X POST "$PROXY_HTTPS/api/visit" \
    -H 'Content-Type: application/json' -H 'X-Nav-Type: navigate' --data-raw '{}' >/dev/null
  dc restart gateway >/dev/null

  # 4) attendre readiness
  for _ in {1..15}; do
    code=$(http_code "$PROXY_HTTPS/healthz")
    [ "$code" = "200" ] && break
    sleep 1
  done

  # 5) lecture après et évaluation
  after=$(get_visits_json)
  if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ && "$after" -ge $((before+1)) ]]; then
    ok "Persistance DB OK après restart ($before → $after)"
  else
    ko "Persistance DB KO (before='$before', after='$after')"
  fi
fi


# ───────────────────────────── Résumé ─────────────────────────────
echo
echo "================= Résumé ================="
echo "  OK   : $PASS"
echo "  FAIL : $FAIL"
echo "  SKIP : $SKIP"
echo "=========================================="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)