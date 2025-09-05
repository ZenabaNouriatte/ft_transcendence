.PHONY: up down re logs ps clean certs

up:
	docker compose up -d
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
	docker compose down -v

build:
	docker compose build --no-cache --pull

restart: clean build up
