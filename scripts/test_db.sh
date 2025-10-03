#!/usr/bin/env bash
set -euo pipefail

BASE="https://localhost:8443"
UNAME="manual_$(date +%s)_$RANDOM"
EMAIL="$UNAME@test.local"
PASS='TempPass123!'

echo "== 1) Register =="
REG=$(curl -sk -X POST "$BASE/api/users/register" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$UNAME\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
echo "$REG"
USER_ID=$(echo "$REG" | jq -r '.userId // .user.id // empty')
[ -n "$USER_ID" ] || { echo "!! register KO"; exit 1; }

echo "== 2) Login =="
TOKEN=$(curl -sk -X POST "$BASE/api/users/login" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"username\":\"$UNAME\",\"password\":\"$PASS\"}" | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "!! login KO"; exit 1; }
echo "token: ${TOKEN:0:20}..."

echo "== 3) /me (avant restart) =="
curl -sk "$BASE/api/users/me" -H "Authorization: Bearer $TOKEN" | jq .

echo "== 4) Restart gateway =="
docker compose restart gateway >/dev/null

echo "== 5) Wait gateway readiness via /metrics =="
for i in {1..30}; do
  code=$(curl -k -s -o /dev/null -w "%{http_code}" "$BASE/metrics")
  [ "$code" = "200" ] && { echo "gateway ready"; break; }
  sleep 1
done
[ "$code" = "200" ] || { echo "!! gateway pas prêt"; exit 1; }

echo "== 6) Re-login (retry) =="
TOKEN2=""
for i in {1..8}; do
  LOGIN_RES=$(curl -sk -X POST "$BASE/api/users/login" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"username\":\"$UNAME\",\"password\":\"$PASS\"}" \
    -w $'\n%{http_code}')
  LOGIN_CODE="${LOGIN_RES##*$'\n'}"
  LOGIN_BODY="${LOGIN_RES%$'\n'*}"
  if [ "$LOGIN_CODE" = "200" ]; then
    TOKEN2=$(printf '%s' "$LOGIN_BODY" | jq -r .token)
    [ -n "$TOKEN2" ] && [ "$TOKEN2" != "null" ] && break
  fi
  echo "… encore $((8-i)) essais (dernier code=$LOGIN_CODE)"
  sleep 1
done
[ -n "$TOKEN2" ] && [ "$TOKEN2" != "null" ] || { echo "!! re-login KO (dernier code=$LOGIN_CODE, body=$LOGIN_BODY)"; exit 1; }
echo "token2: ${TOKEN2:0:20}..."

echo "== 7) /me (après restart) =="
curl -sk "$BASE/api/users/me" -H "Authorization: Bearer $TOKEN2" | jq .

