FROM nginx:alpine
RUN apk add --no-cache bash openssl curl

COPY nginx.conf.tmpl /etc/nginx/nginx.conf.tmpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Génère les certs AU BUILD avec tes noms de fichiers
RUN mkdir -p /etc/nginx/certs && \
    cat > /tmp/openssl.cnf <<'CFG'
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN = local-ftt
[v3_req]
subjectAltName = @alt
[alt]
DNS.1 = localhost
IP.1  = 127.0.0.1
CFG

RUN openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout /etc/nginx/certs/server.key \
      -out /etc/nginx/certs/server.crt \
      -config /tmp/openssl.cnf && rm -f /tmp/openssl.cnf

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
