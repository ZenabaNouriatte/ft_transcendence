#!/bin/bash
# elk-init.sh - Initialisation complète d'Elasticsearch avec rétention
# Configuration mot de passe kibana_system + politiques de rétention

set -euo pipefail

# === CONFIGURATION MDP SECU ELK ===

ES_URL_EXTERNAL="${ES_URL_EXTERNAL:-http://localhost:9200}"
ES_URL_INTERNAL="http://elasticsearch:9200"
ES_USER="${ES_USER:-elastic}"
ES_PASS="${ES_PASS:-elastic}"
KIBANA_SYS_PASS="${KIBANA_SYS_PASS:-kibana}"


CONTAINER_NAME="$(docker ps --format '{{.Names}}' | grep -m1 elasticsearch || true)"
[ -n "${CONTAINER_NAME}" ] || exit 1

# Attendre qu'Elasticsearch soit prêt 
ready=0
for _ in {1..60}; do
  if docker exec "$CONTAINER_NAME" curl -s -u "${ES_USER}:${ES_PASS}" \
    "${ES_URL_EXTERNAL}/_cluster/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || exit 1

# === CONFIGURATION UTILISATEUR KIBANA ===

# Existence de l'utilisateur kibana_system
USER_CHECK_CODE="$(docker exec "$CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" \
  -u "${ES_USER}:${ES_PASS}" "${ES_URL_EXTERNAL}/_security/user/kibana_system" || echo "000")"
[ "$USER_CHECK_CODE" = "200" ] || exit 1

# Mot de passe de kibana_system
PASS_SET_CODE="$(docker exec "$CONTAINER_NAME" curl -s -o /dev/null -w "%{http_code}" \
  -u "${ES_USER}:${ES_PASS}" -X POST "${ES_URL_EXTERNAL}/_security/user/kibana_system/_password" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"${KIBANA_SYS_PASS}\"}" || echo "000")"
[ "$PASS_SET_CODE" = "200" ] || exit 1

# Test de connexion avec kibana_system
docker exec "$CONTAINER_NAME" curl -s -u "kibana_system:${KIBANA_SYS_PASS}" \
  "${ES_URL_EXTERNAL}/_cluster/health" >/dev/null 2>&1 || exit 1






# === CONFIGURATION RETENTION ===
# Politique ILM et le template (silencieux)
ilm_result=0
template_result=0

docker exec "$CONTAINER_NAME" curl -X PUT "${ES_URL_INTERNAL}/_ilm/policy/ftt-logs-policy" \
  -u "${ES_USER}:${ES_PASS}" \
  -H "Content-Type: application/json" \
  -d '{
    "policy": {
      "phases": {
        "hot": {
          "actions": {
            "rollover": {
              "max_size": "5GB",
              "max_age": "7d"
            }
          }
        },
        "warm": {
          "min_age": "7d",
          "actions": {
            "allocate": {
              "number_of_replicas": 0
            }
          }
        },
        "delete": {
          "min_age": "30d"
        }
      }
    }
  }' >/dev/null 2>&1 || ilm_result=1

docker exec "$CONTAINER_NAME" curl -X PUT "${ES_URL_INTERNAL}/_index_template/ftt-logs-template" \
  -u "${ES_USER}:${ES_PASS}" \
  -H "Content-Type: application/json" \
  -d '{
    "index_patterns": ["ftt-logs-*"],
    "template": {
      "settings": {
        "index.lifecycle.name": "ftt-logs-policy",
        "index.number_of_shards": 1,
        "index.number_of_replicas": 0
      },
      "mappings": {
        "properties": {
          "@timestamp": { "type": "date" },
          "service": { 
            "type": "text",
            "fields": {
              "keyword": { "type": "keyword", "ignore_above": 256 }
            }
          },
          "level": { 
            "type": "text",
            "fields": {
              "keyword": { "type": "keyword", "ignore_above": 256 }
            }
          },
          "message": { "type": "text" },
          "kind": { 
            "type": "text",
            "fields": {
              "keyword": { "type": "keyword", "ignore_above": 256 }
            }
          },
          "action": { 
            "type": "text",
            "fields": {
              "keyword": { "type": "keyword", "ignore_above": 256 }
            }
          },
          "env": { 
            "type": "text",
            "fields": {
              "keyword": { "type": "keyword", "ignore_above": 256 }
            }
          }
        }
      }
    }
  }' >/dev/null 2>&1 || template_result=1

# Messages finaux
if [ $ilm_result -eq 0 ] && [ $template_result -eq 0 ]; then
  echo "- ELK security OK"
  echo "- ELK data retention OK"
fi

# === Injecter 1 log d'erreur de démonstration dans Logstash (TCP 5000) ===
if [ "${SKIP_DEMO_LOGS:-false}" != "true" ]; then
  # Tentative d'injection avec gestion d'erreur non bloquante
  if docker compose exec -T logstash bash -lc '
i=0
while [ $i -lt 30 ]; do
  if (echo > /dev/tcp/127.0.0.1/5000) >/dev/null 2>&1; then
    break
  fi
  sleep 1
  i=$((i+1))
done
printf "{\"event\":{\"ts\":\"$(date -u +%FT%TZ)\",\"service\":\"backend\",\"env\":\"dev\",\"level\":\"error\",\"msg\":\"Simulated error for Kibana\",\"kind\":\"game\",\"action\":\"start\"}}\\n" > /dev/tcp/127.0.0.1/5000
' >/dev/null 2>&1; then
    echo "- Demo log injected OK"
  fi
fi

