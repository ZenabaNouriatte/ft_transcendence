# ft_transcendence

## Information générale et architecture

##  Démarrage rapide

```bash
make up       # Lance tout l'environnement 
make down     # Arrête tous les services
make clean    # Arrête tout et supprime les volumes de données
make logs     # Affiche les logs en temps réel
make restart  # Nettoyage complet + redémarrage
```


##  URLs d'accès

| Service | URL | Authentification |
|---------|-----|------------------|
| **Application principale** | https://localhost:8443 | - |
| **Grafana** (monitoring) | https://localhost:8443/grafana/ | admin / admin123! |
| **Prometheus** (métriques) | https://localhost:8443/prometheus/ | - |
| **Kibana** (logs) | https://localhost:8443/kibana/ | elastic / elastic |
| **Alertmanager** (alertes) | https://localhost:8443/alertmanager/ | - |

>  **Note** : http://localhost:8080 redirige automatiquement vers HTTPS

## 📁 Structure du projet

```
ft_transcendence/
├──  backend/                    # API Gateway + Microservices (Node.js/TypeScript)
│   ├── src/
│   │   ├── modules/               # Architecture microservices
│   │   │   ├── auth/              # Authentification (JWT, bcrypt)
│   │   │   ├── game/              # Moteur de jeu Pong + validation
│   │   │   ├── chat/              # Validation messages/DM
│   │   │   ├── tournament/        # Brackets & matchmaking
│   │   │   └── user/              # Gestion profils utilisateurs
│   │   ├── database/              # SQLite + requêtes
│   │   ├── services/              # 📊 Services métier
│   │   └── common/                # 🛡️ Validation & sécurité
│   └── Dockerfile
├──  frontend/                   # SPA TypeScript + TailwindCSS
│   ├── src/
│   │   ├── pages/                 # Pages SPA (home, game, tournament, etc.)
│   │   ├── game/                  # Client de rendu Pong
│   │   ├── chat/                  # Interface chat temps réel
│   │   ├── auth.ts                # Gestion tokens
│   │   ├── router.ts              # Navigation SPA
│   │   └── websocket.ts           # WebSocket client
│   ├── public/images/             # Assets statiques
│   └── Dockerfile
├──  proxy/                      # Reverse proxy Nginx + SSL/TLS
│   ├── nginx.conf.tmpl            # Configuration routes + sécurité
│   └── certs/                     # Certificats SSL auto-générés
├──  monitoring/                 # Stack observabilité
│   ├── grafana/                   # Dashboards & visualisation
│   ├── prometheus/                # Collecte métriques
│   ├── alertmanager/              # Gestion alertes
│   └── elk/                       # Logs (Elasticsearch + Logstash + Kibana)
├──  scripts/                    # Outils tests
├──  Doc/                        
├── docker-compose.yml             
├── Makefile                       
└── .env                           
```


### Frontend
- **TypeScript** : mandatory
- **TailwindCSS** 
- **SPA Router** : Navigation sans rechargement
- **WebSocket** : Communication temps réel

### Backend
- **Node.js + TypeScript** 
- **Fastify** : Framework web haute performance
- **SQLite** : Base de données légère
- **Architecture microservices** : Services découplés

### Infrastructure
- **Docker Compose** 
- **Nginx** : Reverse proxy + SSL/TLS
- **Monitoring Stack** : Prometheus + Grafana + ELK
- **HTTPS natif** : mandatory

##  Sécurité

- **HTTPS/TLS 1.2+** : Chiffrement transport
- **JWT sécurisés** : Authentification stateless
- **bcrypt cost 10** : Hash passwords robust
- **Protection XSS** : Sanitisation centralisée
- **SQL paramétrées** : Anti-injection
- **Headers sécurisés** : HSTS, CSP, X-Frame-Options
- **Rate limiting** : Protection DDoS
- **Variables .env** : Credentials isolés


### Flux de communication inter-services

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Communication Pattern                              │
│                                                                             │
│  Browser ──HTTPS──► Nginx Proxy ──HTTP──► Gateway (:8000)                  │
│                                               │                             │
│                                               ▼                             │
│                                          SQLite DB                         │
│                                               ▲                             │
│                                               │                             │
│                        ┌──────────────────────┼──────────────────────┐      │
│                        │                     │                      │      │
│                        ▼                     ▼                      ▼      │
│            Auth (:8101) ◄─────► Chat (:8103) ◄────► Tournament (:8104)     │
│                        │                     │                      │      │
│                        ▼                     ▼                      ▼      │
│            Game (:8102) ◄─────────────► User (:8105)                       │
│                                                                             │
│  • Microservices ──HTTP calls──► Gateway pour accès DB                     │
│  • Gateway ──HTTP responses──► Microservices                               │
│  • Tous les services exposent /healthz et /metrics                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

##  Architecture des conteneurs

| Couche | Service | Port | Rôle |
|--------|---------|------|------|
| ** Frontend** | `frontend` | 80 | SPA TypeScript + assets statiques |
| ** Proxy** | `proxy` | 80,443 | Nginx reverse proxy + SSL/TLS |
| ** Backend** | `gateway` | 8000 | API Gateway principal + SQLite |
| | `auth` | 8101 | Microservice authentification |
| | `chat` | 8102 | Microservice validation chat |
| | `game` | 8103 | Microservice logique jeu |
| | `tournament` | 8104 | Microservice tournois |
| | `user` | 8105 | Microservice utilisateurs |
| ** Monitoring** | `prometheus` | 9090 | Collecte métriques |
| | `grafana` | 3000 | Dashboards & visualisation |
| | `alertmanager` | 9093 | Gestion alertes |
| ** Logs** | `elasticsearch` | 9200 | Stockage logs structurés |
| | `logstash` | 5000 | Traitement logs |
| | `kibana` | 5601 | Interface exploration logs |


##  Tests & Validation

### Script de test automatisé
```bash
./scripts/testeur.sh
```

**Vérifications effectuées :**
-  **Infrastructure** : Proxy & Gateway (connectivité Nginx)
-  **API** : Santé des endpoints et routing microservices
-  **Communication** : WebSockets temps réel + ping services
-  **Monitoring** : Prometheus/Grafana/ELK stack complète
-  **Persistance** : Base de données SQLite + cycle complet utilisateur
-  **Sécurité** : Tests complets sécurité 

Authentification & Chiffrement :
-  **bcrypt** : Vérification hashage mots de passe (pattern `$2a$` ou `$2b$`)
-  **JWT** : Validation tokens et protection routes API (401/403)
-  **HTTPS/TLS** : Certificats SSL + redirection HTTP→HTTPS

Protection injections :
-  **XSS** : Test injection `<script>alert(1)</script>` → bloqué
-  **SQL Injection** : Test `'; DROP TABLE users--` → bloqué
-  **Validation** : Email/password format + longueur

Contrôles d'accès :
-  **Routes protégées** : `/api/users/me` sans token → 401
-  **Sanitisation** : Caractères dangereux dans usernames rejetés
-  **Rate limiting** : Protection contre brute force

### Autres scripts utiles
```bash
./scripts/elk-init.sh     # Initialisation stack ELK
```


## 📈 Monitoring & Observabilité

### Métriques disponibles (Grafana)
- **Performance** : Latence API, throughput WebSocket
- **Santé services** : Status codes, erreurs, uptime
- **Base de données** : Requêtes SQLite, connexions
- **Système** : CPU, mémoire, réseau des conteneurs

### Logs centralisés (ELK)
- **Application** : Logs applicatifs structurés
- **Nginx** : Logs d'accès et erreurs
- **Système** : Logs des conteneurs Docker

### Alertes (Alertmanager)
- Services indisponibles (> 30s)
- Surcharge système (CPU > 80%)
- Erreurs HTTP (> 5% 5xx)
