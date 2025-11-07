#!/usr/bin/env sh
set -eu

CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key
CONF_TMPL=/etc/nginx/nginx.conf.tmpl
CONF_OUT=/etc/nginx/nginx.conf

# 1) L’hôte public vu par les clients (IP ou DNS) — passé par l’hôte Mac
PUBLIC_HOST="${PUBLIC_HOST:-localhost}"
mkdir -p /etc/nginx/certs

# 2) Construire le SAN: localhost + 127.0.0.1 + PUBLIC_HOST (IP ou DNS)
CN="$PUBLIC_HOST"
ALT_BLOCK='DNS.1 = localhost\nIP.1 = 127.0.0.1'
case "$PUBLIC_HOST" in
  *.*.*.*) ALT_BLOCK="$ALT_BLOCK\nIP.2 = $PUBLIC_HOST" ;; # IP v4
  *)       ALT_BLOCK="$ALT_BLOCK\nDNS.2 = $PUBLIC_HOST" ;; # Nom DNS
esac

# 3) (Re)générer le certificat 
cat > /tmp/openssl.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN = $CN
[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
basicConstraints = CA:FALSE
[alt]
$ALT_BLOCK
EOF

openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout "$KEY" -out "$CERT" -config /tmp/openssl.cnf >/dev/null 2>&1 || {
  echo "[proxy] openssl failed"; exit 1; }
rm -f /tmp/openssl.cnf
openssl x509 -in "$CERT" -noout -ext subjectAltName || true

# 4) Rendu du template Nginx (tes substitutions existantes)
GATEWAY_IP="$(ip route | awk '/default/ {print $3; exit}')" || true
ALLOWLIST_DEFAULT="127.0.0.1 ::1 ${GATEWAY_IP:-}"
ALLOW_DIRECTIVES=""
for ip in ${ALLOWLIST_IPS:-$ALLOWLIST_DEFAULT}; do
  [ -n "$ip" ] || continue
  ALLOW_DIRECTIVES="$ALLOW_DIRECTIVES    allow $ip;\n"
done

: "${FRONTEND_ORIGIN:=https://${PUBLIC_HOST}:8443}"

# Remplace les placeholders dans le template
printf "%b" "$(sed -e "s|\${ALLOW_DIRECTIVES}|${ALLOW_DIRECTIVES}|g" \
                   -e "s|\${FRONTEND_ORIGIN}|${FRONTEND_ORIGIN}|g" \
                   "$CONF_TMPL")" > "$CONF_OUT"

nginx -t
exec "$@"
