#!/bin/bash
# Script de load test WebSocket

CONCURRENT_USERS=10
TEST_DURATION=30

echo "🧪 Starting WebSocket load test: $CONCURRENT_USERS users for $TEST_DURATION seconds"

for ((i=1; i<=$CONCURRENT_USERS; i++)); do
  echo "Starting user $i..."
  docker-compose exec -T gateway node -e "
    const WebSocket = require('ws');
    const ws = new WebSocket('ws://localhost:8000/ws');
    let messageCount = 0;
    
    ws.on('open', () => {
      console.log('User $i connected');
      
      // Envoi périodique de messages
      const interval = setInterval(() => {
        ws.send(JSON.stringify({
          type: 'chat.message',
          data: { text: 'load-test-user-$i' },
          requestId: 'user-$i-' + Date.now()
        }));
        messageCount++;
      }, 1000);
      
      // Arrêt après la durée du test
      setTimeout(() => {
        clearInterval(interval);
        ws.close();
        console.log('User $i sent ' + messageCount + ' messages');
      }, $TEST_DURATION * 1000);
    });
    
    ws.on('error', (err) => {
      console.log('User $i error:', err.message);
    });
    
    ws.on('close', () => {
      console.log('User $i disconnected');
    });
  " &
done

echo "✅ Load test started! Check Grafana dashboard..."
echo "Waiting $TEST_DURATION seconds..."
sleep $TEST_DURATION

echo "📊 Test completed! Checking metrics..."
curl -s http://localhost:9090/api/v1/query?query=websocket_connections_active
curl -s http://localhost:9090/api/v1/query?query=ws_messages_total