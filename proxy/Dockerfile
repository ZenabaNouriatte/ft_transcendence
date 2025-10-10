FROM nginx:alpine
RUN apk add --no-cache bash openssl curl

COPY nginx.conf.tmpl /etc/nginx/nginx.conf.tmpl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Génère les certs AU BUILD avec IP dynamique (0.0.0.0 pour accepter toutes les IPs)
RUN mkdir -p /etc/nginx/certs

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
