#!/usr/bin/env bash
set -euo pipefail

CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key
CONF_TMPL=/etc/nginx/nginx.conf.tmpl
CONF_OUT=/etc/nginx/nginx.conf

# 1) Certs et template présents ?
[[ -s "$CERT" && -s "$KEY" ]] || { echo "[proxy] ERROR: missing TLS certs ($CERT / $KEY)"; exit 1; }
[[ -s "$CONF_TMPL" ]] || { echo "[proxy] ERROR: missing template $CONF_TMPL"; exit 1; }

# 2) Allowlist IPs -> directives "allow"
GATEWAY_IP="$(ip route | awk '/default/ {print $3; exit}')" || true
ALLOWLIST_DEFAULT="127.0.0.1 ::1 ${GATEWAY_IP:-}"
ALLOW_DIRECTIVES=""
for ip in ${ALLOWLIST_IPS:-$ALLOWLIST_DEFAULT}; do
  [[ -n "$ip" ]] || continue
  ALLOW_DIRECTIVES+=$'    allow '"${ip};\n"
done
# 3) Rendu du template
sed -e "s|\${ALLOW_DIRECTIVES}|${ALLOW_DIRECTIVES}|g" \
    -e "s|\${FRONTEND_ORIGIN}|${FRONTEND_ORIGIN:-https://localhost:8443}|g" \
    "$CONF_TMPL" > "$CONF_OUT"

# 4) Lint + start
nginx -t
exec "$@"
