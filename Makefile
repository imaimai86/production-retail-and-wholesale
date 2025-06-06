COMPOSE=docker compose -f server/docker-compose.yml

.PHONY: build up down logs test migrate db-init backup restore

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

test: up
	$(COMPOSE) exec server npm test
	$(MAKE) down

migrate:
	$(COMPOSE) exec server bash ./script/migrate.sh

db-init:
	$(COMPOSE) exec server bash ./script/db.sh

backup:
	$(COMPOSE) exec db pg_dump -U postgres -d app > server/backup/manual_backup.sql

restore:
	cat server/backup/manual_backup.sql | $(COMPOSE) exec -T db psql -U postgres -d app
