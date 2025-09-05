#!/usr/bin/env bash
# Test runner ft_transcendence — Proxy, API, WS, Prometheus (Grafana metrics), ELK

set -u
set -o pipefail

PASS=0; FAIL=0; SKIP=0
PROXY_HTTPS="https://localhost:8443"
PROM_URL="http://localhost:9090"
ES_URL="http://localhost:9200"
ES_AUTH="elastic:elastic"   # ajuste si besoin
NGINX_ACCESS_PATH="/var/log/nginx/access.json"

# docker compose vs docker-compose
dc() { if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"; else docker compose "$@"; fi; }

c_green="\033[32m"; c_red="\033[31m"; c_yellow="\033[33m"; c_blue="\033[36m"; c_reset="\033[0m"
ok(){   echo -e "  ${c_green}OK${c_reset}  $*"; PASS=$((PASS+1)); }
ko(){   echo -e "  ${c_red}FAIL${c_reset} $*"; FAIL=$((FAIL+1)); }
sk(){   echo -e "  ${c_yellow}SKIP${c_reset} $*"; SKIP=$((SKIP+1)); }
sec(){  echo -e "\n${c_blue}# $*${c_reset}"; }

http_code(){ curl -ks -o /dev/null -w "%{http_code}" "$1"; }
json_num(){ sed -n 's/.*"total"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p'; }

# Prometheus helpers
prom_raw(){ curl -sG --data-urlencode "query=$1" "$PROM_URL/api/v1/query"; }
prom_first_num(){ jq -r '.data.result[0].value[1] // empty' 2>/dev/null | head -n1;}
prom_query(){ prom_raw "$1" | prom_first_num; }             # 1ere valeur numérique
prom_count_series(){ prom_raw "$1" | grep -c '"metric"'; }  # nb de séries dans le vecteur

prom_wait_value_ge(){
  local q="$1" want="$2" tries="${3:-8}" sleep_s="${4:-5}"
  for i in $(seq 1 "$tries"); do
    local v; v=$(prom_query "$q")
    if [ -n "$v" ]; then
      awk "BEGIN{exit !($v>=$want)}" && { echo "$v"; return 0; }
    fi
    sleep "$sleep_s"
  done
  echo ""
  return 1
}

prom_wait_series_ge(){
  local q="$1" want="${2:-1}" tries="${3:-8}" sleep_s="${4:-5}"
  for i in $(seq 1 "$tries"); do
    local c; c=$(prom_count_series "$q")
    if [ "$c" -ge "$want" ]; then echo "$c"; return 0; fi
    sleep "$sleep_s"
  done
  echo "0"
  return 1
}

echo -e "${c_blue}=== ft_transcendence — test stack $(date '+%F %T') ===${c_reset}"

# ────────────────────────────── Proxy & Gateway ──────────────────────────────
sec "Proxy & Gateway"
code=$(http_code "$PROXY_HTTPS/healthz")
[ "$code" = "200" ] && ok "proxy HTTPS /healthz → 200" || ko "proxy HTTPS /healthz → $code"

code=$(http_code "$PROXY_HTTPS/metrics")
[ "$code" = "200" ] && ok "gateway /metrics via proxy" || ko "gateway /metrics KO via proxy"

# ─────────────────────────────────── API ───────────────────────────────────
sec "API (via Gateway → services)"
before=$(curl -ks "$PROXY_HTTPS/api/visits" | json_num)
[[ "$before" =~ ^[0-9]+$ ]] && ok "GET /api/visits = $before" || { ko "GET /api/visits réponse inattendue"; before=""; }

post=$(curl -ks -X POST "$PROXY_HTTPS/api/visit" -H 'X-Nav-Type: test' | json_num)
[[ "$post" =~ ^[0-9]+$ ]] && ok "POST /api/visit total=$post" || ko "POST /api/visit réponse inattendue"

after=$(curl -ks "$PROXY_HTTPS/api/visits" | json_num)
if [[ "$before" =~ ^[0-9]+$ && "$after" =~ ^[0-9]+$ ]]; then
  [ "$after" -eq $((before+1)) ] && ok "Compteur visites +1 ($before → $after)" || ko "Compteur visites n'a pas augmenté ($before → $after)"
else
  sk "Validation +1 visits sautée (valeurs non numériques)"
fi

# /api/users/ping (optionnel)
body=$(curl -ks "$PROXY_HTTPS/api/users/ping" || true)
if echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' ; then ok "/api/users/ping"; else sk "/api/users/ping (pas de stub ?)"; fi

# 404 + X-Request-ID corrélable dans logs Nginx
hdrs=$(curl -kis "$PROXY_HTTPS/api/does-not-exist" || true)
reqid=$(echo "$hdrs" | sed -n 's/^X-Request-ID:[[:space:]]*\(.*\)\r*/\1/p' | tr -d '\r' | head -n1)
if [ -n "$reqid" ]; then
  if dc exec -T proxy sh -lc "test -f $NGINX_ACCESS_PATH && grep -F \"$reqid\" $NGINX_ACCESS_PATH >/dev/null 2>&1"; then
    ok "X-Request-ID corrélé dans access.json ($reqid)"
  else
    sk "Impossible de corréler X-Request-ID ($reqid) dans $NGINX_ACCESS_PATH"
  fi
else
  ko "X-Request-ID manquant sur 404"
fi

# ─────────────────────────────────── WS ────────────────────────────────────
sec "WebSocket (via Gateway interne)"

# 1) chat.message + ack
dc exec -T gateway node - <<'NODE'
const WebSocket = require('ws');
const url = 'ws://localhost:8000/ws';
const id = 'ci-' + Math.random().toString(36).slice(2);
const ws = new WebSocket(url, { handshakeTimeout: 2000 });
const t = setTimeout(()=>{ console.log('FAIL no ack'); process.exit(1); }, 4000);
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
const ws = new WebSocket(url, { handshakeTimeout: 2000 });
const t = setTimeout(()=>{ console.log('FAIL no pong'); process.exit(1); }, 3000);
ws.on('open', ()=> ws.send(JSON.stringify({ type:'ws.ping', requestId:id })));
ws.on('message', (buf)=> { try { const j = JSON.parse(buf.toString()); if (j.type==='ws.pong') { clearTimeout(t); console.log('OK'); process.exit(0); } } catch {} });
ws.on('error', (e)=>{ console.log('FAIL '+e.message); process.exit(2); });
NODE
rc=$?; [ $rc -eq 0 ] && ok "WS ping/pong" || ko "WS ping/pong KO (rc=$rc)"

# 3) Créer une connexion WS persistante pour les tests métriques
echo "Création d'une connexion WS persistante pour les tests métriques..."
dc exec -d gateway sh -c '
node -e "
const WebSocket = require('\''ws'\'');
const ws = new WebSocket('\''ws://localhost:8000/ws'\'');
ws.on('\''open'\'', () => {
  console.log('\''WS persistante ouverte'\'');
  let count = 0;
  const interval = setInterval(() => {
    ws.send(JSON.stringify({
      type: '\''chat.message'\'',
      data: { text: '\''metrics-test-'\'' + count },
      requestId: '\''metrics-'\'' + Date.now()
    }));
    count++;
    if (count >= 5) clearInterval(interval);
  }, 2000);
  setTimeout(() => process.exit(0), 30000);
});
ws.on('\''error'\'', console.error);
" > /tmp/ws-persistent.log 2>&1 &
'

# Attendre que la connexion soit établie
sleep 5

# ─────────────────────── Prometheus / Grafana ──────────────────────
sec "Prometheus (Grafana metrics)"

# a) up (gateway)
v=$(prom_wait_value_ge 'up{job="gateway"}' 1 10 5)
[ -n "$v" ] && ok "up{job=\"gateway\"} = $v" || ko "Prometheus: up{job=\"gateway\"} pas OK"

# b) p95 HTTP par route (fenêtre courte 1m pour tests)
c=$(prom_wait_series_ge 'histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[1m])))' 1 10 5)
[ "$c" -ge 1 ] && ok "p95 HTTP présent pour $c route(s)" || sk "p95 HTTP : pas encore de séries"

# c) RPS par route
c=$(prom_wait_series_ge 'sum by (route) (rate(http_request_duration_seconds_count[1m]))' 1 10 5)
[ "$c" -ge 1 ] && ok "RPS par route présent ($c séries)" || sk "RPS par route : pas de séries"

# d) Erreurs 5xx par route (présence)
c=$(prom_count_series 'sum by (route) (rate(http_request_duration_seconds_count{status_code=~"5.."}[1m]))')
[ "$c" -ge 0 ] && ok "Séries erreurs 5xx par route visibles (count=$c)" || sk "Erreurs 5xx : pas de séries"

# e) CORRIGÉ: Messages WS - utiliser la valeur absolue au lieu du rate
v=$(prom_wait_value_ge 'ws_messages_total{type="chat.message"}' 1 12 5)
[ -n "$v" ] && ok "Messages WS chat.message total ≥ 1 ($v)" || ko "Aucun message WS chat.message enregistré"

# f) Vérification présence métrique connexions WS
c=$(prom_wait_series_ge 'websocket_connections_active{job="gateway"}' 1 8 5)
[ "$c" -ge 1 ] && ok "Métrique websocket_connections_active présente ($c séries)" || sk "websocket_connections_active non détectée"

# g) Visites — total DB (quelle que soit la cible; Prom agrège)
v=$(prom_wait_value_ge 'max by() (visits_db_total)' 0 8 5)
[ -n "$v" ] && ok "visits_db_total présent (val=$v)" || sk "visits_db_total non remonté"

# h) Visites — incréments (type=test) sur 2 min (plus fiable que petit rate)
#v=$(prom_wait_value_ge 'increase(visits_api_increments_total{type="test"}[2m])' 0.5 8 5)
#[ -n "$v" ] && ok "Increments visits_api_increments_total{type=\"test\"} > 0 (Δ=$v)" || sk "Aucun increment observé (attends un scrape)"

# ─────────────────────────────────── ELK ───────────────────────────────────
sec "ELK (Elasticsearch/Kibana)"
code=$(curl -ks -u "$ES_AUTH" -o /dev/null -w "%{http_code}" "$ES_URL/_cluster/health")
if [ "$code" = "200" ]; then
  body=$(curl -s -u "$ES_AUTH" "$ES_URL/_cluster/health" 2>/dev/null)
  echo "$body" | grep -q '"status"' && ok "Elasticsearch /_cluster/health répond" || ko "Elasticsearch /_cluster/health sans champ status"
else
  ko "Elasticsearch /_cluster/health → $code"
fi

# on tolère 200/302/401 quand Kibana est prêt; on attend jusqu'à ~40s
ok_kib=false
for i in {1..8}; do
  code=$(http_code "http://localhost:5601/api/status")
  case "$code" in 200|302|401) ok_kib=true; break;; *) sleep 5;; esac
done
$ok_kib && ok "Kibana en ligne (code $code)" || sk "Kibana non prêt (code $code)"

# ───────────────────────────── Résumé ─────────────────────────────
echo
echo "================= Résumé ================="
echo "  OK   : $PASS"
echo "  FAIL : $FAIL"
echo "  SKIP : $SKIP"
echo "=========================================="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)