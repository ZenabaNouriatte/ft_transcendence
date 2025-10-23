# ft_transcendence

## Information générale et architecture

### Démarrage rapide

```bash
make up       # Lance tout (dev)
make down     # Arrête tout
make clean    # Arrête tout et supprime les volumes
make logs     # Voir les logs
make restart  # Arrête tout, supprime les volumes et relance
```

## URLs importantes

App : https://localhost:8443 (http://localhost:8080 est redirigé vers la précédente)

WebSocket : https://localhost:8443/ws-test.html

Grafana : http://localhost:3000 (admin/admin)

Prometheus : https://localhost:9090

Kibana : https://localhost:5601

Alertmanager : https://localhost:9093

## Structure du projet

``` ft_transcendence/
├── backend/                  # Node.js/TypeScript (Fastify) — modules = microservices logiques
│   └── src/modules/{auth,chat,game,tournament, user}/http.ts
├── frontend/                 # TypeScript
├── proxy/                    # Nginx (reverse proxy + TLS)
├── monitoring/               # Observabilité (Prometheus, Grafana, Alertmanager, ELK)
│   ├── grafana/ (provisioning + dashboards)
│   ├── prometheus/ (scrape + rules)
│   ├── alertmanager/
│   └── elk/ (elasticsearch, logstash, kibana)
├── scripts/                  # Testeurs, charge, init ELK...
└── Doc/                      # Documentation (ce fichier)
```

## Avantages techniques

Scalabilité : architecture microservices containerisée
Sécurité : SSL/TLS natif, reverse proxy, isolation des services
Monitoring : observabilité complète (métriques, logs, alertes)

Technologies utilisées

Frontend : Vanilla TypeScript, TailwindCSS
Backend : Node.js,TypeScript, WebSocket
Base de données : SQLite
Monitoring : Prometheus, Grafana, ELK Stack
Infrastructure : Docker, Nginx, SSL

## Containerisation

| **Frontend**             | frontend                 |
|------------------------|----------------------------------|
| **Nginx** | proxy |
| **Backend** | gateway       |
|             | chat     |
|             | game          |
|             | tournament   |
|             | auth          |
|             | user          |
| **Monitoring** | grafana  |
|             | prometheus          |
|             | altermanager          |
|             | elasticsearch          |
|             | logstash          |
|             | kibana          |

⚠️ Pour garantir l’architecture, ne touchez pas à :

- docker-compose.yml → architecture figée
- monitoring/ → Prometheus/Grafana configurés
- elk/ → stack de logs configurée
- */Dockerfile → bases images, users, ports exposés (sécurité/CI)
- proxy/nginx.conf.tmpl → routage configuré
- proxy/certs/, proxy/entrypoint.sh → génération/chargement certs & bootstrap proxy

## Mise en place d’un testeur

./scripts/testeur.sh

Utile pour voir si on a pas casse toute l’archi
- Proxy & Gateway (Nginx)
- API (via Gateway)
- API – Pings par service (via Gateway)
- WebSockets
- Prometheus / Grafana
- ELK
- Persistance des données de la DB