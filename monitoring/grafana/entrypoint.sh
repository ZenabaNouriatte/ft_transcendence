#!/bin/sh
set -e

# Générer un certificat auto-signé si absent
CERT_DIR=/etc/grafana/certs
CERT_FILE=$CERT_DIR/server.crt
KEY_FILE=$CERT_DIR/server.key

mkdir -p $CERT_DIR

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Generating self-signed certificate for Grafana..."
  
  cat > /tmp/openssl.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN = localhost
[v3_req]
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
basicConstraints = CA:FALSE
[alt]
DNS.1 = localhost
IP.1 = 127.0.0.1
DNS.2 = grafana
EOF

  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -config /tmp/openssl.cnf 2>/dev/null
  
  rm -f /tmp/openssl.cnf
  echo "Certificate generated successfully"
fi

# Lancer Grafana
exec /run.sh "$@"