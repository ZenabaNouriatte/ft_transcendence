#!/bin/bash
# elk-init.sh - Initialisation complète des utilisateurs Elasticsearch
set -euo pipefail

echo "=== Initialisation Elasticsearch Security ==="

# Charger les variables depuis .env si présent
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

ELASTIC_PASSWORD="${ELASTIC_PASSWORD:-elastic123}"
KIBANA_SYSTEM_PASSWORD="${KIBANA_SYSTEM_PASSWORD:-kibana123}"
CONTAINER_NAME="${CONTAINER_NAME:-ft_transcendence-elasticsearch-1}"

echo "1. Attente du démarrage d'Elasticsearch..."
for i in {1..60}; do
  if docker exec "$CONTAINER_NAME" curl -s http://localhost:9200 >/dev/null 2>&1; then
    echo "   ✓ Elasticsearch répond"
    break
  fi
  echo "   Tentative $i/60..."
  sleep 2
done

echo ""
echo "2. Configuration du mot de passe 'elastic'..."
# Utiliser elasticsearch-reset-password en mode batch
docker exec "$CONTAINER_NAME" \
  /usr/share/elasticsearch/bin/elasticsearch-reset-password \
  -u elastic -b -a -s -p "$ELASTIC_PASSWORD" || {
    echo "   ⚠ Mot de passe 'elastic' peut-être déjà configuré"
  }

echo ""
echo "3. Attente de la disponibilité avec auth..."
sleep 5

echo ""
echo "4. Configuration du mot de passe 'kibana_system'..."
docker exec "$CONTAINER_NAME" curl -s \
  -u "elastic:$ELASTIC_PASSWORD" \
  -X POST "http://localhost:9200/_security/user/kibana_system/_password" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$KIBANA_SYSTEM_PASSWORD\"}" || {
    echo "   ✗ Échec de la configuration kibana_system"
    exit 1
  }

echo ""
echo "=== ✓ Configuration terminée ==="
echo "Utilisateurs configurés:"
echo "  - elastic: $ELASTIC_PASSWORD"
echo "  - kibana_system: $KIBANA_SYSTEM_PASSWORD"
echo ""
echo "Vous pouvez maintenant démarrer Kibana et Logstash:"
echo "  docker-compose up -d kibana logstash"