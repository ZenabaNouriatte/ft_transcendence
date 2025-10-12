.PHONY: up down re logs ps clean certs

PUBLIC_HOST := $(shell ./scripts/public_host.sh)
FRONT_ORIGINS := https://$(PUBLIC_HOST):8443,https://localhost:8443
PROJECT := ft_transcendence
DC := COMPOSE_PROJECT_NAME=$(PROJECT) PUBLIC_HOST="$(PUBLIC_HOST)" FRONT_ORIGINS="$(FRONT_ORIGINS)" docker compose

up:
	$(DC) up -d --build
	./scripts/elk-init.sh
	$(DC) restart kibana

down:
	$(DC) down

re: down up

logs:
	$(DC) logs -f

ps:
	$(DC) ps

clean:
	$(DC) down -v

build:
	$(DC) build --no-cache --pull

restart: clean build up

front-build:
	cd frontend && npm install && npm run build