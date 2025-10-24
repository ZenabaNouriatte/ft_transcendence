#!/bin/bash
# elk-diagnostic.sh - Diagnostic approfondi

echo "=== DIAGNOSTIC ELASTICSEARCH ==="
echo ""

# 1. Status container
echo "1. Status du container:"
docker-compose ps elasticsearch
echo ""

# 2. Logs complets
echo "2. Logs Elasticsearch (50 dernières lignes):"
docker-compose logs --tail=50 elasticsearch
echo ""

# 3. Santé du cluster
echo "3. Test de connexion:"
curl -s http://localhost:9200 && echo "✓ Répond sans auth" || echo "✗ Ne répond pas"
curl -s -u elastic:elastic123 http://localhost:9200 && echo "✓ Auth OK" || echo "✗ Auth échoue"
echo ""

# 4. Ressources système
echo "4. Ressources système:"
free -h
echo ""
df -h | grep -E "Filesystem|/dev/vda1|overlay"
echo ""

# 5. Configuration actuelle
echo "5. Variables d'environnement (dans le container):"
docker-compose exec elasticsearch env | grep -E "ELASTIC|KIBANA|XPACK" || echo "Container non démarré"
echo ""

# 6. Fichiers de config
echo "6. Contenu de elasticsearch.yml:"
docker-compose exec elasticsearch cat /usr/share/elasticsearch/config/elasticsearch.yml 2>/dev/null || \
  cat monitoring/elk/elasticsearch/elasticsearch.yml
echo ""

# 7. Processus Java
echo "7. Processus Java dans le container:"
docker-compose exec elasticsearch ps aux | grep java || echo "Container non démarré"
echo ""

# 8. Ports
echo "8. Ports en écoute:"
docker-compose exec elasticsearch netstat -tlnp 2>/dev/null || echo "netstat non disponible"
echo ""

# 9. Espace disque du volume
echo "9. Utilisation du volume:"
docker volume inspect ft_transcendence_esdata | jq '.[0].Mountpoint'
echo ""

echo "=== FIN DIAGNOSTIC ==="