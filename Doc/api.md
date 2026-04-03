# 📡 Architecture API - ft_transcendence

## Table des matières

- [Candidature - Correspondances avec l'annonce Doctolib](#candidature---correspondances-avec-lannonce-doctolib)
- [Vue d'ensemble](#vue-densemble)
- [Création de l'API](#création-de-lapi)
- [Architecture par domaine](#architecture-par-domaine)
- [Comment fonctionne un endpoint](#comment-fonctionne-un-endpoint)
- [Flux de données](#flux-de-données)
- [Communication inter-services](#communication-inter-services)
- [WebSocket temps réel](#websocket-temps-réel)
- [Base de données](#base-de-données)
- [Sécurité](#sécurité)
- [Ce que Fastify gère](#ce-que-fastify-gère)
- [Ce que le projet gère](#ce-que-le-projet-gère)

---

## 🎯 Candidature - Correspondances avec l'annonce Doctolib

### Analyse du projet par rapport aux missions demandées

#### 1️⃣ Connecteurs API et formats structurés (HL7 / JSON / FHIR)

**Annonce :** *"Participer à la mise en place de connecteurs API utilisant les formats HL7, JSON et FHIR"*

**Ce que j'ai fait :**
- ✅ **Architecture API REST complète** : 5 microservices communicant en JSON structuré
- ✅ **Format JSON standardisé** : Tous les endpoints utilisent JSON pour les requêtes/réponses
- ✅ **Schéma de données structuré** : SQLite avec relations et validation des données
- ✅ **Communication inter-services HTTP** : Exemple de fetch vers microservices auth/game/chat

**Code pertinent :**
```typescript
// backend/src/index.ts - Communication avec services métier
const response = await fetch("http://auth:8101/validate-password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password, hashedPassword })
});
const data = await response.json();  // Parsing JSON structuré
```

**Points transférables à HL7/FHIR :**
- Expérience de parsing/validation de formats structurés (JSON)
- Gestion des erreurs et des codes de statut HTTP
- Intégration de systèmes distribués via API REST
- **Base pour apprendre FHIR** : Format XML/JSON similaire à JSON avec schéma strict

---

#### 2️⃣ Systèmes distribués et interopérabilité

**Annonce :** *"Bonne compréhension des API REST et des architectures de systèmes distribués"*

**Ce que j'ai fait :**
- ✅ **Architecture microservices 5 services** : Gateway + Auth + Game + Chat + Tournament + User
- ✅ **Communication distribuée** : Services communiquent via HTTP+JSON sur réseau Docker
- ✅ **Orchestration avec Docker Compose** : 13 conteneurs orchestrés (services, monitoring, infra)
- ✅ **API REST complète** : 20+ endpoints avec HTTP methods (GET, POST, PUT)
- ✅ **Gestion des erreurs distribuées** : Try-catch, status codes, timeouts

**Architecture :**
```
5 services indépendants → Gateway central → Clients
Chaque service = service métier (comme des hôpitaux)
Gateway = router (comme un hub d'interopérabilité)
```

**Points transférables :**
- Expérience d'intégration de services hétérogènes
- Gestion de la latence réseau et des timeouts
- Monitoring de systèmes distribués (Prometheus, Grafana)
- Scalabilité horizontale (chaque service peut être répliqué)

---

#### 3️⃣ Automatisation et développement Python/IA

**Annonce :** *"Créer et paramétrer des assistants IA en développant des prompts complexes"*
*"Contribuer aux travaux d'automatisation avec Python et les technologies d'IA"*

**Opportunités dans le projet :**
- 🔴 **Non implémenté** : Mais l'architecture le permet
- ✅ **Possibilité d'ajouter :** Python scripts pour :
  - Transformation de données HL7 → JSON
  - Validation FHIR via Python validators
  - Scripts d'intégration entre services
  - Assistants IA pour mapper données hôpitaux

**Exemple de ce qui serait possible :**
```python
# Script Python d'intégration (à ajouter)
import requests
import json
from fhir.resources import Patient

# Convertir données hôpital → FHIR Patient
patient_data = fetch_from_hospital_api()
fhir_patient = Patient(**transform_to_fhir(patient_data))

# Envoyer au gateway
requests.post(
    'http://gateway:8000/api/users',
    json=fhir_patient.dict()
)
```

---

#### 4️⃣ Compétences requises - Correspondances

| Compétence demandée | Justification du projet |
|-------------------|------------------------|
| **API REST** | ✅ 20+ endpoints, HTTP methods, status codes |
| **Architectures distribuées** | ✅ Microservices, Docker Compose, services indépendants |
| **JSON** | ✅ Format d'échange principal dans tout le projet |
| **TypeScript/JavaScript** | ✅ Backend en TypeScript (Fastify), Frontend en TS |
| **Git & CI/CD** | ✅ Repository GitHub, Dockerfile, docker-compose.yml |
| **Gestion de projet** | ✅ Projet complet 110% à École 42, organisation modules |
| **Travail en équipe** | ✅ Projet 42 (travail collaboratif), code reviews possibles |
| **Bases de données** | ✅ SQLite, schéma structuré, requêtes paramétrées |
| **Sécurité** | ✅ JWT, bcrypt, XSS protection, SQL injection prevention |
| **Monitoring** | ✅ Prometheus, Grafana, ELK Stack, logging structuré |

---

#### 5️⃣ Compétences bonus demandées

| Bonus demandé | Correspondance |
|--------------|----------------|
| **Standards HL7/FHIR** | 🔴 Non implémenté, mais base JSON transférable |
| **Projets d'automatisation** | 🟡 Webserver automatisé, ELK setup auto, possible expansion |
| **Git & CI/CD** | ✅ GitHub repo complet, docker-compose automation |
| **Python/IA** | 🔴 Non implémenté, mais architecture extensible |

---

### Points clés à mettre en avant en entretien

#### 1. Architecture et interopérabilité
> *"J'ai conçu une architecture microservices avec 5 services indépendants communicant en JSON via REST API. Cela démontre ma compréhension des systèmes distribués et de l'interopérabilité - compétences clés pour intégrer HL7/FHIR."*

#### 2. Traitement de données structurées
> *"Le projet utilise JSON structuré pour toutes les communications. FHIR et HL7 étant des formats similaires (JSON/XML avec schéma strict), je peux rapidement apprendre à parser et valider ces standards."*

#### 3. Gestion des erreurs distribuées
> *"J'ai implémenté une gestion robuste des timeouts, erreurs réseau, et retry logic entre services. C'est crucial pour des intégrations hôpitaux où la fiabilité est critique."*

#### 4. Monitoring et observabilité
> *"J'ai mis en place Prometheus + Grafana + ELK Stack pour monitorer 13 services. Dans un contexte hôpital, ce monitoring est essentiel pour tracker les transferts de données sensibles."*

#### 5. Sécurité des données
> *"Implémentation de JWT, bcrypt, XSS protection, SQL injection prevention. Les données de santé nécessitent une sécurité renforcée - j'ai démontré cette rigueur."*

---

### Fichier à ajouter : Exemple d'intégration HL7/FHIR

Pour renforcer la candidature, il serait pertinent d'ajouter un fichier exemple montrant comment intégrer FHIR :

```typescript
// backend/src/modules/health/fhir.ts (À CRÉER)
// Exemple d'intégration FHIR Patient Resource

interface FHIRPatient {
  resourceType: "Patient";
  id: string;
  name: [{ given: string[]; family: string }];
  telecom: [{ system: "email"; value: string }];
  birthDate: string;
  gender: "male" | "female";
}

// Transformer user local → FHIR Patient
export function userToFHIRPatient(user: any): FHIRPatient {
  return {
    resourceType: "Patient",
    id: `patient-${user.id}`,
    name: [{ given: user.username.split(" "), family: user.username }],
    telecom: [{ system: "email", value: user.email }],
    birthDate: user.birthDate,
    gender: user.gender
  };
}

// Endpoint FHIR (à ajouter à index.ts)
app.get("/api/fhir/Patient/:id", async (request, reply) => {
  const user = await UserService.findUserById(request.params.id);
  return userToFHIRPatient(user);
});
```

**Cette approche montre :**
- Compréhension de FHIR Resource format
- Capacité à transformer données entre formats
- Prêt à travailler sur intégrations réelles

---

### Résumé pour la candidature

**Forces du projet pour Doctolib :**
1. ✅ Architecture distribuée et scalable (5 services)
2. ✅ Communication structurée en JSON (base FHIR)
3. ✅ Gestion d'erreurs robuste (importante pour santé)
4. ✅ Monitoring complet (Prometheus/Grafana/ELK)
5. ✅ Sécurité renforcée (JWT, bcrypt, XSS protection)
6. ✅ Orchestration Docker (déploiement production-ready)
7. ✅ TypeScript (type safety pour données sensibles)

**À développer pour le stage :**
1. 🔄 Apprendre FHIR/HL7 standards
2. 🔄 Ajouter Python scripts d'automatisation
3. 🔄 Explorer IA/prompting pour transformation données
4. 🔄 Implémenter exemple FHIR Patient Resource

---

## Vue d'ensemble

L'API est construite sur une **architecture microservices** avec un **Gateway API** central orchestrant 5 services spécialisés.

```
┌──────────────────────────────────────────────────────────────┐
│                     CLIENT (Frontend)                        │
│              (TypeScript SPA, Canvas Pong)                   │
└─────────────────────┬──────────────────────────────────────┘
                      │ JSON HTTP + WebSocket
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                  NGINX PROXY (Reverse)                       │
│                    :8443 (HTTPS/TLS)                         │
└─────────────────────┬──────────────────────────────────────┘
                      │ JSON HTTP + WebSocket
                      ▼
┌──────────────────────────────────────────────────────────────┐
│        GATEWAY (backend/src/index.ts) :8000                  │
│  • Route requests                                            │
│  • JWT authentication                                        │
│  • Call microservices (HTTP JSON)                            │
│  • WebSocket management (JSON)                               │
│  • SQLite database access                                    │
└─────────┬──────────┬──────────┬──────────┬────────────────┘
          │          │          │          │
    JSON │    JSON  │   JSON   │   JSON  │    JSON
        │          │          │          │
        ▼          ▼          ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
    │  AUTH  │ │ GAME   │ │ CHAT   │ │ TOURN. │ │ USER   │
    │:8101   │ │ :8102  │ │ :8103  │ │ :8104  │ │ :8105  │
    └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
          │
          └─► SQLite DB (shared)
              /data/app.sqlite
```

---

## Création de l'API

### Fichier principal

**Fichier :** `backend/src/index.ts` (1850 lignes)

```typescript
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

// Initialisation du serveur
const app = Fastify({ 
  logger: true,           // Logs structurés
  trustProxy: true        // Trust Nginx headers
});

// Plugins de sécurité
app.register(helmet);           // Sécurité HTTP headers
app.register(cors);             // CORS
app.register(rateLimit);        // Rate limiting
app.register(underPressure);    // Backpressure
```

### Technologie utilisée

🔴 **Fastify** - Framework web haute performance

**Pourquoi Fastify ?**
- ⚡ 2-3x plus rapide que Express
- 📦 Léger (~30KB)
- 🔌 Plugin system puissant
- 📊 Metrics intégrées
- 🧪 Excellent pour les tests

---

## Architecture par domaine

Les routes sont organisées en **5 modules microservices** :

```
backend/src/modules/
├── auth/http.ts              # JWT validation, password hashing
├── user/http.ts              # Profile, statistics, friends
├── game/http.ts              # Game logic, rules validation
├── chat/http.ts              # Messages, direct messages
└── tournament/http.ts        # Brackets, matchmaking
```

### Routes par module

#### 🔐 Authentication (`auth/http.ts`)

```
POST   /api/users/register              # Créer compte
POST   /api/users/login                 # Se connecter
POST   /api/users/logout                # Se déconnecter
POST   /api/auth/validate-token         # Vérifier JWT
```

#### 👤 Users (`user/http.ts`)

```
GET    /api/users                       # Lister utilisateurs
GET    /api/users/:id/profile           # Profil utilisateur
PUT    /api/users/:id/profile           # Modifier profil
GET    /api/users/:id/stats             # Statistiques
GET    /api/users/:id/friends           # Liste amis
POST   /api/friends/request/:userId     # Ajouter ami
```

#### 🎮 Games (`game/http.ts`)

```
POST   /api/games                       # Créer partie
GET    /api/games                       # Lister parties
GET    /api/games/:id/state             # État en temps réel
POST   /api/games/:id/start             # Lancer partie
POST   /api/games/:id/paddle            # Mouvement paddle
POST   /api/games/:id/pause             # Pause partie
POST   /api/games/:id/resume            # Reprendre partie
POST   /api/games/:id/finish            # Terminer partie
```

#### 💬 Chat (`chat/http.ts`)

```
POST   /api/messages                    # Envoyer message
GET    /api/messages/:userId            # Historique messages
GET    /api/messages/channel/:channelId # Messages canal
POST   /api/users/block/:userId         # Bloquer utilisateur
```

#### 🏆 Tournaments (`tournament/http.ts`)

```
POST   /api/tournaments                 # Créer tournoi
GET    /api/tournaments                 # Lister tournois
GET    /api/tournaments/:id             # Détails tournoi
POST   /api/tournaments/:id/join        # Rejoindre tournoi
GET    /api/tournaments/:id/bracket     # Bracket structure
```

---

## Comment fonctionne un endpoint

### Exemple : POST `/api/users/login`

```
┌─────────────────────────────────────────────────────────┐
│  CLIENT (Frontend)                                      │
│                                                         │
│  fetch('/api/users/login', {                           │
│    method: 'POST',                                     │
│    body: JSON.stringify({                              │
│      username: 'alice',                                │
│      password: 'secret123'                             │
│    })                                                  │
│  })                                                    │
└────────────────────┬────────────────────────────────────┘
                     │ JSON HTTP
                     ▼
┌─────────────────────────────────────────────────────────┐
│  NGINX PROXY (Reverse)                                 │
│  • Déchiffre HTTPS → HTTP                              │
│  • Ajoute headers (X-Real-IP, etc.)                    │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP
                     ▼
┌─────────────────────────────────────────────────────────┐
│  GATEWAY (backend/src/index.ts:359)                    │
│                                                         │
│  1️⃣  Fastify parse JSON automatiquement               │
│     request.body = { username: 'alice', ... }          │
│                                                         │
│  2️⃣  Sanitize input (PROJET)                          │
│     sanitizeUsername('alice')                          │
│     ✅ Validation format: [a-zA-Z0-9_-]{3,20}        │
│     ✅ Protection XSS                                  │
│                                                         │
│  3️⃣  Query database (PROJET)                          │
│     UserService.findUserByUsername('alice')            │
│     ❌ Utilisateur not found → 401                     │
│     ✅ Utilisateur trouvé → continue                  │
│                                                         │
│  4️⃣  Call AUTH microservice (PROJET)                  │
│     fetch('http://auth:8101/validate-password')        │
│     body: {                                             │
│       password: 'secret123',                           │
│       hashedPassword: '$2b$10$...'                     │
│     }                                                   │
│     ✅ bcrypt.compare() = true → continue              │
│                                                         │
│  5️⃣  Generate JWT token (PROJET)                      │
│     jwt.sign({ userId: 42 }, JWT_SECRET)              │
│     token = 'eyJhbGc...' (expires 24h)                │
│                                                         │
│  6️⃣  Update user status (PROJET)                      │
│     UserService.updateUserStatus(42, 'online')         │
│                                                         │
│  7️⃣  Return object (Fastify)                          │
│     return {                                            │
│       ok: true,                                         │
│       user: { id: 42, username: 'alice', ... },        │
│       token: 'eyJhbGc...'                              │
│     }                                                   │
│     Fastify convertit automatiquement en JSON           │
└────────────────────┬────────────────────────────────────┘
                     │ JSON HTTP 200 OK
                     ▼
┌─────────────────────────────────────────────────────────┐
│  NGINX PROXY (Reverse)                                 │
│  • Chiffre HTTP → HTTPS                                │
│  • Ajoute security headers                             │
└────────────────────┬────────────────────────────────────┘
                     │ JSON HTTPS
                     ▼
┌─────────────────────────────────────────────────────────┐
│  CLIENT (Frontend)                                      │
│                                                         │
│  response.json() = {                                   │
│    ok: true,                                           │
│    user: { id: 42, username: 'alice', ... },          │
│    token: 'eyJhbGc...'                                │
│  }                                                      │
│                                                         │
│  ✅ Store token in localStorage                        │
│  ✅ Redirect to dashboard                              │
└─────────────────────────────────────────────────────────┘
```

---

## Flux de données

### Format de requête

**Tous les endpoints acceptent du JSON :**

```json
{
  "username": "alice",
  "password": "secret123"
}
```

### Format de réponse réussi (2xx)

```json
{
  "ok": true,
  "user": {
    "id": 42,
    "username": "alice",
    "email": "alice@example.com",
    "avatar": "avatar_url",
    "status": "online"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Headers HTTP :**
```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 245
```

### Format d'erreur (4xx, 5xx)

```json
{
  "error": "invalid_credentials",
  "message": "Username or password incorrect"
}
```

**HTTP Status codes utilisés :**
- `200` - OK (succès)
- `201` - Created (ressource créée)
- `400` - Bad Request (données invalides)
- `401` - Unauthorized (authentification requise)
- `403` - Forbidden (permission refusée)
- `404` - Not Found (ressource inexistante)
- `500` - Internal Server Error (bug serveur)

---

## Communication inter-services

Le **Gateway** appelle les **5 microservices** en HTTP+JSON :

```typescript
// backend/src/index.ts (ligne 376)
const response = await fetch("http://auth:8101/validate-password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },  // TU spécifies JSON
  body: JSON.stringify({ 
    password: "secret123",
    hashedPassword: "$2b$10$..." 
  })
});

// Parse la réponse JSON
const data = await response.json();  // { ok: true/false }
if (!data.ok) {
  return reply.code(401).send({ error: "invalid_credentials" });
}
```

### Services internes

| Service | Port | Endpoints |
|---------|------|-----------|
| **auth** | 8101 | `/validate-password`, `/generate-token`, `/validate-token` |
| **game** | 8102 | `/validate-game-creation`, `/move-paddle`, `/end-game` |
| **chat** | 8103 | `/send-message`, `/get-messages` |
| **tournament** | 8104 | `/validate-join`, `/generate-bracket` |
| **user** | 8105 | `/get-profile`, `/update-profile` |

### Architecture interne (Docker network)

```
docker-compose.yml définit un network "transcendence"
↓
Tous les conteneurs communiquent par DNS interne
gateway → fetch('http://auth:8101/...')
         ↓
         Docker résout 'auth' → IP conteneur auth
         ↓
         Requête HTTP interne (port 8101)
```

---

## WebSocket temps réel

Pour le **jeu Pong en temps réel**, on utilise **WebSocket avec JSON** :

### Initialisation

```typescript
// backend/src/ws-raw.ts
const gameRoomManager = new GameRoomManager();

app.register(async (app) => {
  app.websocketHandler(async (ws, req) => {
    // ws = WebSocket connection
    
    ws.on('message', (data) => {
      const message = JSON.parse(data);  // Parse JSON
      // { type: 'paddle_move', gameId: '42', y: 250 }
      
      handleGameMessage(message);
    });
    
    ws.on('close', () => {
      // Nettoyage
    });
  });
});
```

### Messages WebSocket (JSON)

**Client → Server (joueur bouge la raquette) :**
```json
{
  "type": "paddle_move",
  "gameId": "42",
  "y": 250,
  "timestamp": 1704067200000
}
```

**Server → All Clients (état du jeu) :**
```json
{
  "type": "game_state",
  "gameId": "42",
  "player1": {
    "y": 100,
    "score": 2
  },
  "player2": {
    "y": 250,
    "score": 1
  },
  "ball": {
    "x": 400,
    "y": 300,
    "vx": -5,
    "vy": 3
  },
  "timestamp": 1704067200050
}
```

**Server → All Clients (partie terminée) :**
```json
{
  "type": "game_ended",
  "gameId": "42",
  "winner": {
    "id": 42,
    "username": "alice"
  },
  "final_score": {
    "player1": 5,
    "player2": 3
  }
}
```

### Broadcasting

```typescript
// Envoyer à tous les joueurs d'un match
function broadcastToGame(gameId, message) {
  const connections = gameConnections.get(gameId);
  
  connections.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));  // Convert to JSON
    }
  });
}
```

---

## Base de données

### Fichier

**Fichier :** `backend/src/database/index.ts`

```typescript
import Database from "better-sqlite3";

// Connection singleton
const db = new Database('/data/app.sqlite');

// Schéma initialisé depuis backend/src/database/schema.sql
```

### Tables principales

**users :**
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,  -- bcrypt hash
  avatar TEXT,
  status TEXT,  -- 'online' | 'offline' | 'in_game'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**games :**
```sql
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  player1_id INTEGER NOT NULL,
  player2_id INTEGER,
  status TEXT,  -- 'waiting' | 'playing' | 'finished'
  player1_score INTEGER DEFAULT 0,
  player2_score INTEGER DEFAULT 0,
  winner_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(player1_id) REFERENCES users(id),
  FOREIGN KEY(player2_id) REFERENCES users(id)
);
```

**messages :**
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  sender_id INTEGER NOT NULL,
  recipient_id INTEGER,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(sender_id) REFERENCES users(id),
  FOREIGN KEY(recipient_id) REFERENCES users(id)
);
```

### Requêtes paramétrées (SQL Injection Protection)

```typescript
// ✅ SAFE - Requête paramétrée
db.prepare(`
  SELECT * FROM users WHERE username = ?
`).get(sanitizedUsername);

// ❌ UNSAFE - SQL Injection possible
db.exec(`
  SELECT * FROM users WHERE username = '${username}'
`);
```

### Services de base de données

```typescript
// backend/src/services/index.ts

export class UserService {
  static async findUserById(id: number) {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  }
  
  static async findUserByUsername(username: string) {
    return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
  }
  
  static async createUser(username: string, email: string, passwordHash: string) {
    return db.prepare(`
      INSERT INTO users (username, email, password)
      VALUES (?, ?, ?)
    `).run(username, email, passwordHash);
  }
}

export class GameService {
  static async createGame(player1_id: number, player2_id: number | null) {
    return db.prepare(`
      INSERT INTO games (player1_id, player2_id, status)
      VALUES (?, ?, 'waiting')
    `).run(player1_id, player2_id);
  }
}
```

---

## Sécurité

### 1. Input Sanitization (XSS Prevention)

```typescript
// backend/src/index.ts
function sanitizeInput(input: string): string {
  const cleaned = validator.trim(String(input));
  const sanitized = xss(cleaned, { whiteList: {} });  // Strip all HTML
  return sanitized;
}

// Utilisation
const username = sanitizeUsername(request.body.username);
// Input: "<script>alert('xss')</script>"
// Output: "" (tous les tags supprimés)
```

### 2. SQL Injection Prevention

```typescript
// ✅ Requêtes paramétrées (prepared statements)
db.prepare("SELECT * FROM users WHERE username = ?").get(username);

// Tous les paramètres sont échappés par la librairie
```

### 3. Authentication & Authorization

```typescript
// JWT tokens (24h expiry)
const token = jwt.sign({ userId }, JWT_SECRET, { 
  expiresIn: "24h",
  algorithm: "HS256"
});

// Middleware de vérification
async function authMiddleware(request, reply) {
  const token = request.headers.authorization?.split(' ')[1];
  if (!token) return reply.code(401).send({ error: "missing_token" });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    request.userId = decoded.userId;
  } catch {
    return reply.code(401).send({ error: "invalid_token" });
  }
}
```

### 4. Password Security

```typescript
// Hachage bcrypt (10 rounds = ~100ms)
const hashedPassword = await bcrypt.hash(password, 10);

// Vérification
const isValid = await bcrypt.compare(inputPassword, hashedPassword);
```

### 5. Rate Limiting

```typescript
app.register(rateLimit, {
  max: 100,              // 100 requêtes
  timeWindow: '15 min'   // par 15 minutes
});
```

### 6. HTTPS/TLS

```
Nginx proxy gère le chiffrement:
http://client → HTTPS (8443) → nginx → HTTP (gateway:8000)
```

---

## Ce que Fastify gère

✅ **Fastify gère automatiquement :**

### 1. Parsing JSON

```typescript
app.post("/api/users/login", async (request, reply) => {
  // Fastify parse automatiquement le corps JSON
  const { username, password } = request.body;  // ← Déjà parsé
});
```

### 2. Conversion objet → JSON

```typescript
return { ok: true, user: {...} };
// ↓ Fastify convertit automatiquement en JSON
// Content-Type: application/json
// {"ok":true,"user":{...}}
```

### 3. Headers HTTP standards

```typescript
// Fastify ajoute automatiquement :
Content-Type: application/json
Content-Length: 245
Connection: keep-alive
```

### 4. HTTP Status codes

```typescript
reply.code(401).send({ error: "..." });
// ↓ Fastify envoie :
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

### 5. Error handling

```typescript
// Si une exception est levée
throw new Error("Something went wrong");
// ↓ Fastify envoie :
HTTP/1.1 500 Internal Server Error
{"statusCode":500,"error":"Internal Server Error"}
```

### 6. Logging

```typescript
// Fastify log automatiquement
app.log.info({ userId: 42 }, "User logged in");
// ↓ Output :
{"level":30,"userId":42,"msg":"User logged in",...}
```

### 7. Plugins

```typescript
app.register(helmet);          // Security headers
app.register(cors);            // CORS
app.register(rateLimit);       // Rate limiting
app.register(staticPlugin);    // Serving static files
```

---

## Ce que le projet gère

🔴 **Le projet gère :**

### 1. Logique métier

```typescript
// Vérifier si l'utilisateur existe
const user = await UserService.findUserByUsername(username);
if (!user) return reply.code(401).send({ error: "invalid_credentials" });

// Valider le mot de passe
const isValid = await bcrypt.compare(password, user.password);
if (!isValid) return reply.code(401).send({ error: "invalid_credentials" });
```

### 2. Validation des entrées

```typescript
// Validation format username
function sanitizeUsername(username: string): string {
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
    throw new Error("Invalid username format");
  }
  return xss(username, { whiteList: {} });
}

// Validation email
function validateEmail(email: string): boolean {
  return validator.isEmail(email);
}

// Validation password
function validatePassword(password: string): void {
  if (password.length < 8) throw new Error("Password too short");
  if (!/[a-zA-Z]/.test(password)) throw new Error("Need letter");
  if (!/[0-9]/.test(password)) throw new Error("Need digit");
}
```

### 3. Communication avec microservices

```typescript
// Appel au service AUTH
const authResponse = await fetch("http://auth:8101/validate-password", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password, hashedPassword })
});

if (!authResponse.ok) {
  return reply.code(401).send({ error: "invalid_credentials" });
}
```

### 4. Base de données

```typescript
// Créer utilisateur
const userId = await UserService.createUser(
  sanitizedUsername,
  email,
  hashedPassword
);

// Mettre à jour status
await UserService.updateUserStatus(userId, "online");

// Requête complexe
const games = await GameService.getUserGames(userId, limit, offset);
```

### 5. WebSocket management

```typescript
// Gérer les connexions WebSocket par jeu
const gameConnections = new Map<string, Set<WebSocket>>();

// Ajouter à un jeu
function joinGameRoom(gameId: string, ws: WebSocket) {
  if (!gameConnections.has(gameId)) {
    gameConnections.set(gameId, new Set());
  }
  gameConnections.get(gameId)!.add(ws);
}

// Broadcaster à tous
function broadcastToGame(gameId: string, message: any) {
  const connections = gameConnections.get(gameId);
  connections?.forEach((ws) => {
    ws.send(JSON.stringify(message));
  });
}
```

### 6. Gestion des erreurs

```typescript
try {
  const user = await UserService.findUserByUsername(username);
  // ...
} catch (e) {
  request.log.error(e, "login_failed");
  return reply.code(500).send({ error: "login_failed" });
}
```

---

## Résumé complet

| Aspect | Qui gère ? | Code |
|--------|-----------|------|
| **Parse JSON reçu** | Fastify | `request.body` |
| **Valider données** | PROJET | `validateUsername()` |
| **Logique métier** | PROJET | `UserService.findUser()` |
| **Query database** | PROJET | `db.prepare().get()` |
| **Appel services** | PROJET | `fetch()` + `JSON.stringify()` |
| **WebSocket** | PROJET | `ws.send()` + `JSON.stringify()` |
| **Convertir objet en JSON** | Fastify | Automatique |
| **Headers HTTP** | Fastify | Automatique |
| **Status codes** | PROJET (via `reply.code()`) | 401, 500, etc. |
| **Sécurité headers** | Fastify | `@fastify/helmet` |
| **CORS** | Fastify | `@fastify/cors` |
| **Rate limiting** | Fastify | `@fastify/rate-limit` |

---

## Points clés

1. **Fastify = Framework minimaliste**
   - Parse JSON ✅
   - Envoie JSON ✅
   - Reste = à toi de gérer

2. **Le projet = Logique métier + Intégration**
   - Validation données
   - Appel services
   - Gestion base de données
   - WebSocket orchestration

3. **JSON partout**
   - HTTP requêtes/réponses
   - Communication inter-services
   - WebSocket messages
   - Stockage (partiellement)

4. **Architecture distribuée**
   - Gateway orchestre 5 services
   - Services communiquent en HTTP+JSON
   - WebSocket pour temps réel
   - SQLite pour persistance

---

**Créé :** 3 avril 2026  
**Projet :** ft_transcendence (École 42) - 110% ✅
