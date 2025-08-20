#!/usr/bin/env sh
set -e
CERT=/etc/nginx/certs/local.crt
KEY=/etc/nginx/certs/local.key
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -subj "/CN=localhost" \
    -keyout "$KEY" -out "$CERT"
fi
exec nginx -g "daemon off;"
