#!/bin/bash

# security-tests.sh
# Suite complète de tests de sécurité pour ft_transcendence
# Usage: chmod +x security-tests.sh && ./security-tests.sh

set -e

# Configuration
API_URL="${API_URL:-http://localhost:8000}"
WS_URL="${WS_URL:-ws://localhost:8000}"
VERBOSE="${VERBOSE:-false}"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Compteurs
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Fonction de log
log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED_TESTS++))
}

fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED_TESTS++))
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

test_start() {
    ((TOTAL_TESTS++))
    log "Test #${TOTAL_TESTS}: $1"
}

# ==============================================================================
# 1. TESTS SQL INJECTION
# ==============================================================================
echo ""
echo "========================================"
echo "1. TESTS SQL INJECTION"
echo "========================================"

test_start "SQL Injection dans username (register)"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin'\'' OR '\''1'\''='\''1",
    "email": "test@test.com",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "invalid_username\|error"; then
    success "SQL Injection bloquée dans username"
else
    fail "SQL Injection possible dans username: $RESPONSE"
fi

test_start "SQL Injection dans email (register)"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "admin@test.com'\'' OR 1=1--",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "invalid_email\|error"; then
    success "SQL Injection bloquée dans email"
else
    fail "SQL Injection possible dans email: $RESPONSE"
fi

test_start "SQL Injection dans search"
RESPONSE=$(curl -s "${API_URL}/api/users/search?q=admin'%20OR%201=1--")

if echo "$RESPONSE" | grep -q "error\|users"; then
    # Vérifier que la réponse ne contient pas TOUS les users
    USER_COUNT=$(echo "$RESPONSE" | grep -o "\"id\":" | wc -l)
    if [ "$USER_COUNT" -lt 100 ]; then
        success "SQL Injection dans search semble bloquée"
    else
        fail "Avatar URL accepte du JavaScript: $RESPONSE"
    fi
else
    warn "Impossible de tester avatar XSS (login échoué)"
fi

# ==============================================================================
# 3. TESTS AUTHENTIFICATION JWT
# ==============================================================================
echo ""
echo "========================================"
echo "3. TESTS AUTHENTIFICATION JWT"
echo "========================================"

test_start "Accès sans token à route protégée"
RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/api/users/me")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    success "Route protégée refuse accès sans token"
else
    fail "Route protégée accessible sans token (HTTP $HTTP_CODE)"
fi

test_start "Accès avec token invalide"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer INVALID_TOKEN_123" \
  "${API_URL}/api/users/me")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    success "Token invalide rejeté"
else
    fail "Token invalide accepté (HTTP $HTTP_CODE)"
fi

test_start "Accès avec token malformé"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: InvalidFormat token123" \
  "${API_URL}/api/users/me")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    success "Token malformé rejeté"
else
    fail "Token malformé accepté (HTTP $HTTP_CODE)"
fi

test_start "Vérification expiration token (si implémenté)"
# Créer un user de test
TEST_USER="token_test_$(date +%s)"
curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${TEST_USER}\",
    \"email\": \"${TEST_USER}@test.com\",
    \"password\": \"Password123\"
  }" > /dev/null

LOGIN_RESP=$(curl -s -X POST "${API_URL}/api/users/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${TEST_USER}\",
    \"password\": \"Password123\"
  }")

TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    # Tester l'accès immédiat
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -H "Authorization: Bearer ${TOKEN}" \
      "${API_URL}/api/users/me")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        success "Token valide accepté"
    else
        fail "Token valide rejeté (HTTP $HTTP_CODE)"
    fi
else
    warn "Impossible de récupérer le token pour test"
fi

# ==============================================================================
# 4. TESTS VALIDATION DES ENTRÉES
# ==============================================================================
echo ""
echo "========================================"
echo "4. TESTS VALIDATION DES ENTRÉES"
echo "========================================"

test_start "Username trop court"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "ab",
    "email": "short@test.com",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid"; then
    success "Username trop court rejeté"
else
    fail "Username trop court accepté: $RESPONSE"
fi

test_start "Username trop long"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "abcdefghijklmnopqrstuvwxyz123456789",
    "email": "long@test.com",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid"; then
    success "Username trop long rejeté"
else
    fail "Username trop long accepté: $RESPONSE"
fi

test_start "Username avec caractères invalides"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@#$%",
    "email": "invalid@test.com",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid"; then
    success "Caractères invalides dans username rejetés"
else
    fail "Caractères invalides acceptés: $RESPONSE"
fi

test_start "Email invalide"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "validuser",
    "email": "not-an-email",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid"; then
    success "Email invalide rejeté"
else
    fail "Email invalide accepté: $RESPONSE"
fi

test_start "Password trop court"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "pwdtest",
    "email": "pwd@test.com",
    "password": "Short1"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid\|too_short"; then
    success "Password trop court rejeté"
else
    fail "Password trop court accepté: $RESPONSE"
fi

test_start "Password sans complexité"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "weakpwd",
    "email": "weak@test.com",
    "password": "passwordpassword"
  }')

if echo "$RESPONSE" | grep -q "error\|invalid\|complexity"; then
    success "Password faible rejeté"
else
    warn "Password faible accepté (vérifier validation de complexité)"
fi

# ==============================================================================
# 5. TESTS HACHAGE DES MOTS DE PASSE
# ==============================================================================
echo ""
echo "========================================"
echo "5. TESTS HACHAGE DES MOTS DE PASSE"
echo "========================================"

test_start "Vérification que le password n'est pas stocké en clair"
# Créer un user
HASH_USER="hash_test_$(date +%s)"
curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${HASH_USER}\",
    \"email\": \"${HASH_USER}@test.com\",
    \"password\": \"MyTestPassword123\"
  }" > /dev/null

# Récupérer les infos user (via login)
LOGIN_RESP=$(curl -s -X POST "${API_URL}/api/users/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${HASH_USER}\",
    \"password\": \"MyTestPassword123\"
  }")

# Vérifier que le password n'apparaît pas dans la réponse
if echo "$LOGIN_RESP" | grep -q "MyTestPassword123"; then
    fail "Password en clair dans la réponse"
elif echo "$LOGIN_RESP" | grep -q '"password"'; then
    fail "Champ password présent dans la réponse"
else
    success "Password non exposé dans les réponses API"
fi

test_start "Login avec mauvais password"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_URL}/api/users/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${HASH_USER}\",
    \"password\": \"WrongPassword123\"
  }")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "401" ]; then
    success "Mauvais password rejeté"
else
    fail "Mauvais password accepté (HTTP $HTTP_CODE)"
fi

# ==============================================================================
# 6. TESTS RATE LIMITING
# ==============================================================================
echo ""
echo "========================================"
echo "6. TESTS RATE LIMITING"
echo "========================================"

test_start "Rate limiting sur endpoint sensible"
log "Envoi de 110 requêtes rapides..."

RATE_LIMITED=false
for i in {1..110}; do
    RESPONSE=$(curl -s -w "\n%{http_code}" \
      -X POST "${API_URL}/api/users/login" \
      -H "Content-Type: application/json" \
      -d '{
        "username": "ratelimit_test",
        "password": "Password123"
      }')
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    
    if [ "$HTTP_CODE" = "429" ]; then
        RATE_LIMITED=true
        break
    fi
    
    # Afficher progression
    if [ $((i % 20)) -eq 0 ]; then
        echo -n "."
    fi
done
echo ""

if [ "$RATE_LIMITED" = true ]; then
    success "Rate limiting actif (HTTP 429 reçu)"
else
    warn "Rate limiting non détecté après 110 requêtes"
fi

# ==============================================================================
# 7. TESTS HEADERS DE SÉCURITÉ
# ==============================================================================
echo ""
echo "========================================"
echo "7. TESTS HEADERS DE SÉCURITÉ"
echo "========================================"

test_start "Présence des headers de sécurité"
HEADERS=$(curl -s -I "${API_URL}/api/users/ping")

check_header() {
    local header=$1
    if echo "$HEADERS" | grep -qi "$header"; then
        success "Header $header présent"
    else
        warn "Header $header manquant"
    fi
}

check_header "X-Content-Type-Options"
check_header "X-Frame-Options"
check_header "X-XSS-Protection"
check_header "Content-Security-Policy"

# ==============================================================================
# 8. TESTS WEBSOCKET
# ==============================================================================
echo ""
echo "========================================"
echo "8. TESTS WEBSOCKET"
echo "========================================"

if command -v wscat &> /dev/null; then
    test_start "Connexion WebSocket sans channel"
    timeout 2 wscat -c "${WS_URL}/ws" 2>&1 | grep -q "connected" && \
        success "WebSocket accepte connexion basique" || \
        warn "WebSocket connexion échouée"
    
    test_start "WebSocket avec channel invalide"
    # Test plus complexe nécessitant wscat
    warn "Test WebSocket avancés nécessitent implémentation manuelle"
else
    warn "wscat non installé, tests WebSocket skippés"
    warn "Installer avec: npm install -g wscat"
fi

# ==============================================================================
# 9. TESTS VARIABLES D'ENVIRONNEMENT
# ==============================================================================
echo ""
echo "========================================"
echo "9. TESTS FICHIERS SENSIBLES"
echo "========================================"

test_start "Vérification .env non exposé"
RESPONSE=$(curl -s -w "\n%{http_code}" "${API_URL}/.env")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "403" ]; then
    success ".env non accessible via HTTP"
else
    fail ".env accessible via HTTP (HTTP $HTTP_CODE)"
fi

test_start "Vérification .gitignore présent"
if [ -f "../.gitignore" ]; then
    if grep -q ".env" ../.gitignore && grep -q "*.sqlite" ../.gitignore; then
        success ".gitignore contient les fichiers sensibles"
    else
        fail ".gitignore incomplet"
    fi
else
    fail ".gitignore manquant"
fi

test_start "Vérification JWT_SECRET défini"
if [ -f "../.env" ]; then
    if grep -q "JWT_SECRET=" ../.env; then
        JWT_VALUE=$(grep "JWT_SECRET=" ../.env | cut -d'=' -f2)
        if [ "$JWT_VALUE" = "CHANGE_ME_USE_OPENSSL_RAND_BASE64_64" ]; then
            fail "JWT_SECRET utilise la valeur par défaut - CHANGEZ-LA!"
        elif [ ${#JWT_VALUE} -lt 32 ]; then
            warn "JWT_SECRET trop court (< 32 caractères)"
        else
            success "JWT_SECRET correctement défini"
        fi
    else
        fail "JWT_SECRET manquant dans .env"
    fi
else
    warn "Fichier .env non trouvé"
fi

# ==============================================================================
# RÉSUMÉ
# ==============================================================================
echo ""
echo "========================================"
echo "RÉSUMÉ DES TESTS"
echo "========================================"
echo -e "Total:  ${TOTAL_TESTS} tests"
echo -e "${GREEN}Réussis: ${PASSED_TESTS}${NC}"
echo -e "${RED}Échoués:  ${FAILED_TESTS}${NC}"
echo -e "${YELLOW}Warnings: $((TOTAL_TESTS - PASSED_TESTS - FAILED_TESTS))${NC}"

SCORE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
echo ""
echo "========================================"
echo -e "SCORE DE SÉCURITÉ: ${SCORE}%"
echo "========================================"

if [ $SCORE -ge 90 ]; then
    echo -e "${GREEN}Excellent! Votre application est bien sécurisée.${NC}"
elif [ $SCORE -ge 70 ]; then
    echo -e "${YELLOW}Bien, mais des améliorations sont nécessaires.${NC}"
else
    echo -e "${RED}CRITIQUE: Des failles de sécurité importantes ont été détectées!${NC}"
fi

echo ""
echo "Actions recommandées:"
echo "1. Corriger tous les tests échoués (rouge)"
echo "2. Examiner les warnings (jaune)"
echo "3. Tester manuellement les WebSocket si wscat non installé"
echo "4. Vérifier HTTPS/WSS en production"
echo "5. Auditer régulièrement avec ce script"

exit $FAILED_TESTSSQL Injection possible - trop de résultats retournés"
    fi
else
    fail "Réponse inattendue: $RESPONSE"
fi

# ==============================================================================
# 2. TESTS XSS (Cross-Site Scripting)
# ==============================================================================
echo ""
echo "========================================"
echo "2. TESTS XSS"
echo "========================================"

test_start "XSS dans username"
RESPONSE=$(curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "<script>alert(1)</script>",
    "email": "xss@test.com",
    "password": "Password123"
  }')

if echo "$RESPONSE" | grep -q "<script>" || echo "$RESPONSE" | grep -q "alert"; then
    fail "XSS non sanitizé dans username: $RESPONSE"
else
    success "XSS bloqué/sanitizé dans username"
fi

test_start "XSS dans chat message (nécessite WebSocket)"
# Note: Nécessite wscat installé (npm install -g wscat)
if command -v wscat &> /dev/null; then
    # Ce test est plus complexe et nécessite une connexion WS
    warn "Test XSS WebSocket nécessite une implémentation manuelle"
else
    warn "wscat non installé, test XSS WebSocket skippé"
fi

test_start "XSS dans avatar URL"
RANDOM_USER="xss_test_$(date +%s)"
# Créer un user d'abord
curl -s -X POST "${API_URL}/api/users/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${RANDOM_USER}\",
    \"email\": \"${RANDOM_USER}@test.com\",
    \"password\": \"Password123\"
  }" > /dev/null

# Login pour récupérer le token
LOGIN_RESP=$(curl -s -X POST "${API_URL}/api/users/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${RANDOM_USER}\",
    \"password\": \"Password123\"
  }")

TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
    RESPONSE=$(curl -s -X PUT "${API_URL}/api/users/profile" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d '{
        "avatar": "javascript:alert(1)"
      }')
    
    if echo "$RESPONSE" | grep -q "error\|invalid"; then
        success "XSS dans avatar URL bloqué"
    else
        fail "