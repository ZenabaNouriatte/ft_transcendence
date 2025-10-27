#!/bin/bash
# elk-init.sh - Initialisation silencieuse du mot de passe kibana_system
# Affiche UNIQUEMENT "Configuration elasticsearch ok" en cas de succès.

set -euo pipefail

# Variables d'environnement
ES_URL="${ES_URL:-http://localhost:9200}"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-elastic}"
KIBANA_SYS_PASS="${KIBANA_SYS_PASS:-kibana}"

# Détection automatique du conteneur Elasticsearch
CONTAINER_NAME="$(docker ps --format '{{.Names}}' | grep -m1 elasticsearch || true)"
[ -n "${CONTAINER_NAME}" ] || exit 1

# Attendre qu'Elasticsearch soit prêt (max ~120s)
ready=0
for _ in {1..60}; do
  if docker exec "$CONTAINER_NAME" curl -s -u "${ES_USER}:${ES_PASS}" \
    "${ES_URL}/_cluster/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || exit 1

# Vérifier l'existence de l'utilisateur kibana_system
USER_CHECK_CODE="$(docker exec "$CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" \
  -u "${ES_USER}:${ES_PASS}" "${ES_URL}/_security/user/kibana_system" || echo "000")"
[ "$USER_CHECK_CODE" = "200" ] || exit 1

# Définir le mot de passe de kibana_system
PASS_SET_CODE="$(docker exec "$CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" \
  -u "${ES_USER}:${ES_PASS}" -X POST "${ES_URL}/_security/user/kibana_system/_password" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${KIBANA_SYS_PASS}\"}" || echo "000")"
[ "$PASS_SET_CODE" = "200" ] || exit 1

# Test de connexion avec kibana_system
docker exec "$CONTAINER_NAME" curl -s -u "kibana_system:${KIBANA_SYS_PASS}" \
  "${ES_URL}/_cluster/health" >/dev/null 2>&1 || exit 1

# Succès : message unique
echo "Configuration elasticsearch ok"
