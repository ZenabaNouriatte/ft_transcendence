#!/usr/bin/env bash
# Script de diagnostic pour les métriques WebSocket

set -e

PROXY_HTTPS="https://localhost:8443"
PROM_URL="http://localhost:9090"

echo "=== DIAGNOSTIC WEBSOCKET METRICS ==="
echo

# 1. Vérifier que les métriques WebSocket sont exposées
echo "1. Vérification des métriques exposées sur /metrics :"
echo "---------------------------------------------------"
metrics_output=$(curl -ks "$PROXY_HTTPS/metrics")
echo "Recherche de websocket_connections_active :"
if echo "$metrics_output" | grep -E "websocket_connections_active" ; then
    echo "✅ Métrique websocket_connections_active trouvée"
else
    echo "❌ Métrique websocket_connections_active ABSENTE"
fi

echo
echo "Recherche de ws_messages_total :"
if echo "$metrics_output" | grep -E "ws_messages_total" ; then
    echo "✅ Métrique ws_messages_total trouvée"
else
    echo "❌ Métrique ws_messages_total ABSENTE"
fi

echo
echo "2. Test de connexion WebSocket directe :"
echo "----------------------------------------"
# Test de connexion WebSocket directe au gateway (port interne 8000)
docker-compose exec -T gateway node -e "
const WebSocket = require('ws');
console.log('Tentative de connexion WebSocket...');
const ws = new WebSocket('ws://localhost:8000/ws');
ws.on('open', () => {
    console.log('✅ Connexion WebSocket établie');
    // Envoyer un message chat.message
    ws.send(JSON.stringify({
        type: 'chat.message',
        data: { text: 'test-diagnostic' },
        requestId: 'diagnostic-' + Date.now()
    }));
    
    setTimeout(() => {
        ws.close();
        console.log('Connexion fermée');
    }, 2000);
});
ws.on('error', (err) => console.log('❌ Erreur WebSocket:', err.message));
ws.on('message', (data) => console.log('📨 Message reçu:', data.toString()));
"

echo
echo "3. Vérification des logs du gateway :"
echo "------------------------------------"
echo "Derniers logs du gateway (cherche les connexions WebSocket) :"
docker-compose logs --tail 20 gateway | grep -i "ws\|websocket\|connection" || echo "Aucun log WebSocket trouvé"

echo
echo "4. Test des métriques après connexion WebSocket :"
echo "------------------------------------------------"
# Attendre un peu pour laisser le temps aux métriques de se mettre à jour
sleep 3

metrics_output_after=$(curl -ks "$PROXY_HTTPS/metrics")
echo "websocket_connections_active après test :"
echo "$metrics_output_after" | grep "websocket_connections_active" || echo "Aucune métrique websocket_connections_active"

echo
echo "ws_messages_total après test :"
echo "$metrics_output_after" | grep "ws_messages_total" || echo "Aucune métrique ws_messages_total"

echo
echo "5. Vérification de Prometheus :"
echo "-------------------------------"
echo "Vérification que Prometheus peut scraper les métriques :"
prom_response=$(curl -sG --data-urlencode "query=websocket_connections_active" "$PROM_URL/api/v1/query" 2>/dev/null || echo "ERROR")
if [ "$prom_response" = "ERROR" ]; then
    echo "❌ Impossible de joindre Prometheus"
else
    if echo "$prom_response" | grep -q '"result":\['; then
        echo "✅ Prometheus répond"
        echo "Résultat query websocket_connections_active :"
        echo "$prom_response" | jq '.data.result' 2>/dev/null || echo "$prom_response"
    else
        echo "⚠️  Prometheus répond mais pas de résultat pour websocket_connections_active"
        echo "$prom_response"
    fi
fi

echo
echo "Query ws_messages_total :"
prom_response2=$(curl -sG --data-urlencode "query=ws_messages_total" "$PROM_URL/api/v1/query" 2>/dev/null || echo "ERROR")
if [ "$prom_response2" != "ERROR" ]; then
    echo "$prom_response2" | jq '.data.result' 2>/dev/null || echo "$prom_response2"
else
    echo "❌ Erreur query ws_messages_total"
fi

echo
echo "6. Configuration Prometheus (job gateway) :"
echo "--------------------------------------------"
echo "Vérification des targets Prometheus :"
targets_response=$(curl -s "$PROM_URL/api/v1/targets" 2>/dev/null || echo "ERROR")
if [ "$targets_response" != "ERROR" ]; then
    echo "$targets_response" | jq '.data.activeTargets[] | select(.labels.job=="gateway") | {job, instance, health, lastError}' 2>/dev/null || echo "Impossible de parser les targets"
else
    echo "❌ Impossible de récupérer les targets Prometheus"
fi

echo
echo "=== FIN DU DIAGNOSTIC ==="