#!/usr/bin/env bash
# diag_graf_prom.sh — Diagnostics redirection Grafana (proxy HTTPS) + scraping Prometheus→Grafana

# -------- Paramètres (modifie si besoin) --------
GRAFANA_URL=${GRAFANA_URL:-https://localhost:8443/grafana}
PROM_INTERNAL=${PROM_INTERNAL:-http://prometheus:9090}     # URL interne Docker de Prometheus
GRAFANA_INTERNAL=${GRAFANA_INTERNAL:-http://grafana:3000}  # URL interne Docker de Grafana

# -------- Détection docker compose --------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "[!] docker compose non trouvé"; exit 1
fi

# -------- Helper : exécuter et afficher la commande --------
run() {
  echo -e "\n$ $*"
  bash -lc "$*"
}

echo "== Containers =="
run "$DC ps"
GRAFANA_CID=$($DC ps -q grafana 2>/dev/null)
PROXY_CID=$($DC ps -q proxy 2>/dev/null)
PROM_CID=$($DC ps -q prometheus 2>/dev/null)

# =======================
# 1) Côté hôte : redirections
# =======================
echo -e "\n==== [A] Hôte → Proxy HTTPS : en-têtes et redirections ===="
run "curl -vkI ${GRAFANA_URL%/}/"
run "curl -vkI ${GRAFANA_URL%/}/login"
run "curl -k -Ls -o /dev/null -w 'final=%{url_effective}\n' ${GRAFANA_URL%/}/"
run "curl -vkL ${GRAFANA_URL%/}/ -o /dev/null | sed -n '1,40p'"

echo -e "\n==== [A2] Cookies/Location utiles (boucles éventuelles) ===="
run "curl -vkI ${GRAFANA_URL%/}/ 2>&1 | egrep -i 'HTTP/1.1|location:|set-cookie:' || true"
run "curl -vkI ${GRAFANA_URL%/}/login 2>&1 | egrep -i 'HTTP/1.1|location:|set-cookie:' || true"

# =======================
# 2) Depuis le proxy : comportement upstream Grafana
# =======================
if [ -n "$PROXY_CID" ]; then
  echo -e "\n==== [B] Proxy → Grafana (amont) ===="
  run "$DC exec proxy sh -lc 'apk add --no-cache curl >/dev/null 2>&1 || true; curl -sI ${GRAFANA_INTERNAL}/ | sed -n \"1,20p\"'"
  run "$DC exec proxy sh -lc 'curl -sI ${GRAFANA_INTERNAL}/grafana/ | sed -n \"1,20p\"'"
  run "$DC exec proxy sh -lc 'curl -sI ${GRAFANA_INTERNAL}/login | sed -n \"1,20p\"'"
  run "$DC exec proxy sh -lc 'curl -sI ${GRAFANA_INTERNAL}/grafana/login | sed -n \"1,20p\"'"

  echo -e "\n==== [B2] NGINX : bloc /grafana/ réellement chargé ===="
  run "$DC exec proxy sh -lc 'grep -Rni \"/grafana\" /etc/nginx /etc/nginx/conf.d /etc/nginx/nginx.conf 2>/dev/null || true'"
  run "$DC exec proxy sh -lc 'awk \"/location \\\/grafana\\\\//,/\\}/\" /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf 2>/dev/null || true'"
fi

# =======================
# 3) Grafana : env et logs
# =======================
if [ -n "$GRAFANA_CID" ]; then
  echo -e "\n==== [C] Grafana runtime (ENV + logs) ===="
  run "$DC exec grafana sh -lc 'env | sort | egrep \"^GF_SERVER_|^GF_AUTH_|^GF_USERS_|^GF_METRICS_\" || true'"
  run "$DC logs --tail=150 grafana | egrep -i \"HTTP Server Listen|subUrl|redirect|error\" || true"
fi

# =======================
# 4) Scraping : Prometheus → Grafana
# =======================
echo -e "\n==== [D] Prometheus → Grafana : endpoints /metrics ===="
if [ -n "$PROM_CID" ]; then
  run "$DC exec prometheus sh -lc 'apk add --no-cache curl jq >/dev/null 2>&1 || true; echo \"# HEAD ${GRAFANA_INTERNAL}/metrics\"; curl -sI ${GRAFANA_INTERNAL}/metrics | sed -n \"1,20p\"'"
  run "$DC exec prometheus sh -lc 'echo \"# HEAD ${GRAFANA_INTERNAL}/grafana/metrics\"; curl -sI ${GRAFANA_INTERNAL}/grafana/metrics | sed -n \"1,20p\"'"
  run "$DC exec prometheus sh -lc 'echo \"# GET  ${GRAFANA_INTERNAL}/metrics (5 lignes)\"; curl -s ${GRAFANA_INTERNAL}/metrics | sed -n \"1,5p\" || true'"

  echo -e "\n==== [D2] Cible Prometheus réellement scrappée (job=grafana) ===="
  run "$DC exec prometheus sh -lc 'curl -s ${PROM_INTERNAL}/api/v1/targets | jq \".data.activeTargets[] | select(.labels.job==\\\"grafana\\\") | {scrapeUrl, lastError, health}\"'"
  echo -e "\n==== [D3] Fichier prometheus.yml (extrait) ===="
  run "$DC exec prometheus sh -lc 'sed -n \"1,200p\" /etc/prometheus/prometheus.yml'"
fi

# =======================
# 5) Grafana expose bien /metrics ?
# =======================
if [ -n "$GRAFANA_CID" ]; then
  echo -e "\n==== [E] Dans Grafana : /metrics disponibles ? ===="
  run "$DC exec grafana sh -lc 'apk add --no-cache curl >/dev/null 2>&1 || true; env | grep -E \"^GF_METRICS_\" || true'"
  run "$DC exec grafana sh -lc 'curl -sI http://localhost:3000/metrics | sed -n \"1,20p\"'"
  run "$DC exec grafana sh -lc 'curl -sI http://localhost:3000/grafana/metrics | sed -n \"1,20p\"'"
  run "$DC exec grafana sh -lc 'curl -s http://localhost:3000/metrics | sed -n \"1,5p\" || true'"
fi

# =======================
# 6) Sanity ports proxy
# =======================
echo -e "\n==== [F] Sanity ports proxy ===="
run "curl -k -sI https://localhost:8443/ >/dev/null && echo OK 8443 || echo KO 8443"
run "curl -k -sI https://localhost/    >/dev/null && echo WARN 443 ON || echo OK 443 OFF"

echo -e "\n[FIN] Copie/colle les entêtes HTTP (HTTP/1.1, Location, Set-Cookie), les URLs 'scrapeUrl/lastError' et les retours sur /metrics pour conclure."
