#!/bin/bash
# elk-init.sh - init mot de passe kibana_system

set -euo pipefail

ES_URL="${ES_URL:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-${ELASTIC_PASSWORD:-elastic}}"
KIBANA_SYS_PASS="${KIBANA_SYS_PASS:-kibana}"

echo "Attente d'Elasticsearch..."
for i in {1..30}; do
  if curl -s -u "${ES_USER}:${ES_PASS}" "${ES_URL}/_cluster/health" >/dev/null 2>&1; then
    echo "✅ Elasticsearch prêt."
    break
  fi
  echo "   tentative $i/30..."
  sleep 2
done

echo "Pose du mot de passe kibana_system..."
curl -s -u "${ES_USER}:${ES_PASS}" \
  -X POST "${ES_URL}/_security/user/kibana_system/_password" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${KIBANA_SYS_PASS}\"}" >/dev/null

echo "Init terminée."
