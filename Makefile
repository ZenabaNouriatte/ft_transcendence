.PHONY: up down re logs ps clean certs migrate setup

PUBLIC_HOST := $(shell ./scripts/public_host.sh)
FRONT_ORIGINS := https://$(PUBLIC_HOST):8443,https://localhost:8443

up:
	PUBLIC_HOST="$(PUBLIC_HOST)" FRONT_ORIGINS="$(FRONT_ORIGINS)" docker compose up -d --build
	./scripts/elk-init.sh
	docker compose restart kibana


down:
	docker compose down

re: down up

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	PUBLIC_HOST="$(PUBLIC_HOST)" FRONT_ORIGINS="$(FRONT_ORIGINS)" docker compose down -v --rmi all

build:
	docker compose build --no-cache --pull

restart: clean build up

front-build:
	cd frontend && npm install && npm run build && docker compose build frontend && docker compose up -d frontend