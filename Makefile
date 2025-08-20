.PHONY: up down re logs ps clean certs

up:
	docker compose up --build -d

down:
	docker compose down

re: down up

logs:
	docker compose logs -f

ps:
	docker compose ps

clean:
	docker compose down -v
