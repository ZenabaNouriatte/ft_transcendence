.PHONY: up down re logs ps clean certs

up:
	docker compose up -d
	./elk-init.sh
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

restart: clean up
