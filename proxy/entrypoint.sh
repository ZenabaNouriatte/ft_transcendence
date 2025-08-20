#!/usr/bin/env sh
set -e
CERT=/etc/nginx/certs/server.crt
KEY=/etc/nginx/certs/server.key

mkdir -p /etc/nginx/certs

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -subj "/CN=localhost" \
    -keyout "$KEY" -out "$CERT"
fi
nginx -t
exec nginx -g "daemon off;"
