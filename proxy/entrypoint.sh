#!/usr/bin/env bash
set -euo pipefail

CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key
CONF_TMPL=/etc/nginx/nginx.conf.tmpl
CONF_OUT=/etc/nginx/nginx.conf

# Récupérer l'IP publique si disponible
PUBLIC_IP="${PUBLIC_IP:-}"
SANS="DNS:localhost,IP:127.0.0.1,IP:0.0.0.0,IP:::1"

if [[ -n "$PUBLIC_IP" ]]; then
    SANS+=",IP:${PUBLIC_IP}"
fi

# 1) Générer le certificat avec SAN étendu
if [[ ! -s "$CERT" || ! -s "$KEY" ]]; then
    echo "[proxy] Generating TLS certificate with SAN: ${SANS}"
    
    cat > /tmp/openssl.cnf <<CFG
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[dn]
CN = ft-transcendence

[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SANS
basicConstraints = CA:FALSE
CFG

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$KEY" \
        -out "$CERT" \
        -config /tmp/openssl.cnf \
        -subj "/C=FR/ST=Paris/L=Paris/O=42/OU=Transcendence/CN=ft-transcendence"
    
    rm -f /tmp/openssl.cnf
    echo "[proxy] Certificate generated with SAN: $SANS"
fi

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
echo "[proxy] Starting nginx with certificate valid for all IPs"
exec "$@"