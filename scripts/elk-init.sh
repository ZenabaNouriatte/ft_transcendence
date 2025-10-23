#!/bin/bash
# elk-init-docker.sh - init mot de passe kibana_system depuis un conteneur

set -euo pipefail

ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-${ELASTIC_PASSWORD:-elastic}}"
KIBANA_SYS_PASS="${KIBANA_SYS_PASS:-kibana}"

echo "Initialisation du mot de passe Kibana via Docker..."

# Exécute le script depuis le conteneur elasticsearch
docker compose exec -T elasticsearch bash <<EOF
set -e

echo "Attente d'Elasticsearch..."
for i in {1..30}; do
  if curl -s -u "${ES_USER}:${ES_PASS}" "http://localhost:9200/_cluster/health" >/dev/null 2>&1; then
    echo "Elasticsearch prêt !"
    break
  fi
  echo "   tentative \$i/30..."
  sleep 2
done

echo "Configuration du mot de passe kibana_system..."
curl -s -u "${ES_USER}:${ES_PASS}" \
  -X POST "http://localhost:9200/_security/user/kibana_system/_password" \
  -H "Content-Type: application/json" \
  -d '{"password":"${KIBANA_SYS_PASS}"}' >/dev/null

echo "Init kibana password OK."
EOF