IMAGE=production-server
COMPOSE=docker compose

build:
$(COMPOSE) build

up: build
$(COMPOSE) up -d

stop:
$(COMPOSE) down

backup:
$(COMPOSE) exec db pg_dump -U app app > backup/dump.sql

restore:
$(COMPOSE) exec -T db psql -U app app < backup/dump.sql

logs:
$(COMPOSE) logs -f

.PHONY: build up stop backup restore logs
