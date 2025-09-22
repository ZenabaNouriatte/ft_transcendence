# Guide d'implémentation - Logique métier dans l'architecture hybride

## 🎯 Objectif
Implémenter la logique métier pour les modules **game**, **chat** et **tournament** en utilisant l'architecture hybride existante.

## 📋 État actuel
- ✅ **auth** : Complètement implémenté (validation, hash, tokens)
- ⚠️ **game, chat, tournament** : Modules vides à compléter
- ✅ **gateway** : Gère la DB et fait appel aux microservices
- ✅ **services** : Réorganisés dans `backend/src/services/index.ts`

## 🏗️ Architecture à respecter
```
Gateway (backend/src/index.ts)
├── Gère la base de données (UserService, GameService, etc.)
├── Expose les APIs REST publiques (/api/users, /api/games...)
└── Appelle les microservices pour la logique métier pure

Microservices (backend/src/modules/*/http.ts)  
├── Logique métier PURE (validations, calculs, algorithmes)
├── PAS d'accès base de données
└── Exposent des endpoints de logique (/validate-*, /process-*)
```

## 📂 Fichiers à modifier

### 1. **backend/src/modules/game/http.ts** 
**À faire** : Extraire la logique métier pure de `backend_init/games.ts`

```typescript
import type { FastifyPluginAsync } from "fastify";

const gameHttp: FastifyPluginAsync = async (app) => {
  // Route de test
  app.get("/ping", async () => ({ ok: true, service: "game" }));

  // Logique de validation de création de partie
  app.post("/validate-game-creation", async (req, reply) => {
    const { player2_id, tournament_id, currentUserId } = req.body as any;
    
    // EXTRAIRE ICI la logique de validation des games.ts
    // - Vérifier les règles métier (pas de jeu contre soi-même, etc.)
    // - Déterminer le statut de la partie
    // - Valider les paramètres
    
    return {
      player2_id,
      status: player2_id ? 'playing' : 'waiting',
      tournament_id,
      updatePlayerStatus: !!player2_id
    };
  });

  // Logique de traitement des mouvements
  app.post("/process-move", async (req) => {
    const { gameState, move } = req.body as any;
    
    // EXTRAIRE ICI la logique de jeu des games.ts
    // - Valider le mouvement
    // - Calculer le nouveau score
    // - Déterminer si la partie est finie
    
    return {
      valid: true,
      newScore: { player1: 0, player2: 1 },
      finished: false
    };
  });
};

export default gameHttp;
```

### 2. **backend/src/modules/tournament/http.ts**
**À faire** : Extraire la logique des `tournement.ts`

```typescript
import type { FastifyPluginAsync } from "fastify";

const tournamentHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "tournament" }));

  // Validation de création de tournoi
  app.post("/validate-tournament", async (req, reply) => {
    const { name, max_players, description } = req.body as any;
    
    // EXTRAIRE ICI la logique de validation des tournement.ts
    // - Validation du nom
    // - Validation du nombre de joueurs (2-32)
    // - Règles de création
    
    if (!name || name.trim().length === 0) {
      return reply.code(400).send({ error: "Nom requis" });
    }
    
    return {
      name: name.trim(),
      max_players: max_players || 8,
      description: description?.trim() || null,
      status: 'waiting'
    };
  });

  // Logique de génération de brackets
  app.post("/generate-brackets", async (req) => {
    const { participants } = req.body as any;
    
    // EXTRAIRE ICI la logique de bracket des tournement.ts
    // - Génération des matchs du premier tour
    // - Algorithme de tournoi
    
    return { brackets: [], rounds: 1 };
  });
};

export default tournamentHttp;
```

### 3. **backend/src/modules/chat/http.ts**
**À faire** : Créer la logique de chat

```typescript
import type { FastifyPluginAsync } from "fastify";

const chatHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "chat" }));

  // Validation des messages
  app.post("/validate-message", async (req, reply) => {
    const { message, type, sender_id } = req.body as any;
    
    // Logique de validation des messages
    // - Filtrage de contenu inapproprié
    // - Validation de la taille
    // - Rate limiting logique
    
    if (!message || message.length > 500) {
      return reply.code(400).send({ error: "Message invalide" });
    }
    
    return {
      message: message.trim(),
      type: type || 'private',
      sender_id,
      timestamp: Date.now()
    };
  });
};

export default chatHttp;
```

## 🔄 Comment adapter votre logique existante

### Étape 1 : Identifier la logique métier
Dans vos fichiers `backend_init/*.ts`, séparez :
- **Logique métier** (validations, calculs, règles) → Va dans les microservices
- **Accès base de données** (create, find, update) → Reste dans le gateway

### Étape 2 : Exemple de migration
**Avant** (dans games.ts) :
```typescript
// Création complète avec DB
const gameId = await GameService.createGame({
  player1_id: userId,
  player2_id,
  status: 'playing'
});
```

**Après - Microservice** (logique pure) :
```typescript
// Validation uniquement
if (userId === player2_id) {
  throw new Error('Impossible de jouer contre soi-même');
}
return { status: 'playing', valid: true };
```

**Après - Gateway** (DB + orchestration) :
```typescript
// 1. Appel microservice
const validation = await fetch('http://game:8102/validate-game-creation', {
  method: 'POST',
  body: JSON.stringify(requestData)
});

// 2. Sauvegarde en DB
const gameId = await GameService.createGame(validationResult);
```

## 📝 Plan de travail suggéré

1. **Commencer par game** (le plus complexe)
   - Extraire les validations des `games.ts`
   - Implémenter `/validate-game-creation` et `/process-move`

2. **Continuer avec tournament**
   - Extraire la logique de `tournement.ts`
   - Implémenter `/validate-tournament` et `/generate-brackets`

3. **Finir par chat** (le plus simple)
   - Créer la validation des messages
   - Implémenter les filtres de contenu

## 🧪 Comment tester

Pour chaque microservice implémenté :
```bash
# Test direct du microservice
curl -sS http://localhost:8102/validate-game-creation \
  -H 'Content-Type: application/json' \
  -d '{"player2_id": 2, "currentUserId": 1}'

# Test via le gateway
curl -k -sS https://localhost:8443/api/games \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"player2_id": 2}'
```

## ⚠️ Points d'attention

- **Ne pas** accéder à la DB dans les microservices
- **Garder** toute la persistance dans le gateway
- **Réutiliser** au maximum la logique existante des `backend_init/*.ts`
- **Tester** chaque microservice indépendamment avant l'intégration

## 📞 Communication
Les microservices communiquent avec le gateway via HTTP uniquement. Pas de base de données partagée.

---

**Fichiers obsolètes après migration** : `backend/src/backend_init/` peut être supprimé une fois la logique migrée.