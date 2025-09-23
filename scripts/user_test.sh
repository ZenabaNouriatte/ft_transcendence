#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://localhost:8443}"

echo "ℹ Base URL: $BASE_URL"
echo "ℹ Ping svc-user & svc-auth…"
docker exec -it ft_transcendence-gateway-1 node -e "
fetch('http://user:8106/ping').then(r=>r.text()).then(console.log).catch(console.error)
"
docker exec -it ft_transcendence-gateway-1 node -e "
fetch('http://auth:8101/ping').then(r=>r.text()).then(console.log).catch(console.error)
"

ts=$(date +%s)
ALICE="alice$ts"
BOB="bob$ts"

# --- Register ALICE
echo "ℹ Register ALICE: $ALICE"
resp=$(curl -k -sS "$BASE_URL/api/users/register" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$ALICE\",\"email\":\"$ALICE@example.test\",\"password\":\"secret\"}")
echo "$resp" | jq .
id_alice=$(echo "$resp" | jq -r '.user.id')
test "$id_alice" != "null" || { echo "✗ register ALICE failed"; exit 1; }

# --- Login ALICE
echo "ℹ Login ALICE…"
resp=$(curl -k -sS "$BASE_URL/api/users/login" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$ALICE\",\"password\":\"secret\"}")
echo "$resp" | jq .
TOKEN_ALICE=$(echo "$resp" | jq -r '.token')
test "$TOKEN_ALICE" != "null" || { echo "✗ login ALICE failed"; exit 1; }
echo "✓ ALICE id=$id_alice"

# --- Register BOB
echo "ℹ Register BOB: $BOB"
resp=$(curl -k -sS "$BASE_URL/api/users/register" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$BOB\",\"email\":\"$BOB@example.test\",\"password\":\"secret\"}")
echo "$resp" | jq .
id_bob=$(echo "$resp" | jq -r '.user.id')
test "$id_bob" != "null" || { echo "✗ register BOB failed"; exit 1; }

# --- Login BOB
echo "ℹ Login BOB…"
resp=$(curl -k -sS "$BASE_URL/api/users/login" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$BOB\",\"password\":\"secret\"}")
echo "$resp" | jq .
TOKEN_BOB=$(echo "$resp" | jq -r '.token')
test "$TOKEN_BOB" != "null" || { echo "✗ login BOB failed"; exit 1; }
echo "✓ BOB id=$id_bob"

echo
echo "== Tests PROFILE =="

# 1) payload vide -> 400
echo "ℹ Profile (vide) → 400"
curl -k -sS -X PUT "$BASE_URL/api/users/profile" \
  -H "Authorization: Bearer $TOKEN_ALICE" \
  -H 'Content-Type: application/json' \
  --data-raw '{}' | jq .

# 2) username trop court -> 400
echo "ℹ Profile (username court) → 400"
curl -k -sS -X PUT "$BASE_URL/api/users/profile" \
  -H "Authorization: Bearer $TOKEN_ALICE" \
  -H 'Content-Type: application/json' \
  --data-raw '{"username":"ab"}' | jq .

# 3) update OK (username + avatar)
NEW_ALICE="new$ALICE"
echo "ℹ Profile OK (username=$NEW_ALICE + avatar)"
curl -k -sS -X PUT "$BASE_URL/api/users/profile" \
  -H "Authorization: Bearer $TOKEN_ALICE" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$NEW_ALICE\",\"avatar\":\"https://picsum.photos/200\"}" | jq .

# 4) Conflit si BOB prend le username d’ALICE -> 409
echo "ℹ Conflit username (BOB prend $NEW_ALICE) → 409"
curl -k -sS -X PUT "$BASE_URL/api/users/profile" \
  -H "Authorization: Bearer $TOKEN_BOB" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$NEW_ALICE\"}" | jq .

echo
echo "== Vérif DB rapide (optionnel) =="

docker exec -it ft_transcendence-gateway-1 sh -lc '
node -e "
  import(\"/app/dist/database/index.js\").then(async m=>{
    await m.initDb();
    const users = await m.all(\"SELECT id,username,email,avatar,status FROM users ORDER BY id DESC LIMIT 5\");
    console.log(JSON.stringify({users}, null, 2));
  }).catch(e=>{ console.error(e); process.exit(1); });
"
'

echo "✓ Tests user terminés ✔"
