COMPOSE=docker compose -f server/docker-compose.yml

.PHONY: build up down logs test

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
