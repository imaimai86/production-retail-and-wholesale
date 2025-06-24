# Variables
IMAGE_NAME := inventory-server
CONTAINER_NAME := inventory-server-container
DB_CONTAINER_NAME := inventory-db-container
DB_IMAGE_NAME := postgres:13-alpine
DB_USER := testuser
DB_PASSWORD := testpassword
DB_NAME := inventorydb
DATABASE_URL := postgres://${DB_USER}:${DB_PASSWORD}@${DB_CONTAINER_NAME}:5432/${DB_NAME}
PORT := 3000

# Default target
.PHONY: all
all: build run

# Build the Docker image for the server
.PHONY: build
build:
	@echo "Building Docker image for the server..."
	@docker build -t $(IMAGE_NAME) ./server

# Run the PostgreSQL database container
.PHONY: run-db
run-db:
	@echo "Starting PostgreSQL container..."
	@if [ $$(docker ps -q -f name=^$(DB_CONTAINER_NAME)$$) ]; then \
		echo "PostgreSQL container is already running."; \
	else \
		docker run -d --name $(DB_CONTAINER_NAME) \
			-e POSTGRES_USER=$(DB_USER) \
			-e POSTGRES_PASSWORD=$(DB_PASSWORD) \
			-e POSTGRES_DB=$(DB_NAME) \
			-p 5432:5432 \
			$(DB_IMAGE_NAME); \
		echo "Waiting for PostgreSQL to be ready..."; \
		sleep 10; \
	fi

# Initialize the database schema
.PHONY: init-db
init-db: run-db
	@echo "Initializing database schema..."
	@docker exec $(DB_CONTAINER_NAME) psql -U $(DB_USER) -d $(DB_NAME) -c "SELECT 1" > /dev/null 2>&1; \
	while [ $$? -ne 0 ]; do \
		echo "Waiting for database to be fully ready..."; \
		sleep 5; \
		docker exec $(DB_CONTAINER_NAME) psql -U $(DB_USER) -d $(DB_NAME) -c "SELECT 1" > /dev/null 2>&1; \
	done
	@docker cp ./server/schema.sql $(DB_CONTAINER_NAME):/schema.sql
	@docker cp ./server/migrations/001_initial.sql $(DB_CONTAINER_NAME):/001_initial.sql
	@docker exec $(DB_CONTAINER_NAME) psql -U $(DB_USER) -d $(DB_NAME) -f /schema.sql
	@docker exec $(DB_CONTAINER_NAME) psql -U $(DB_USER) -d $(DB_NAME) -f /001_initial.sql
	@echo "Database schema initialized."


# Run the server in a Docker container
.PHONY: run
run: build run-db init-db
	@echo "Running server in Docker container..."
	@if [ $$(docker ps -q -f name=^$(CONTAINER_NAME)$$) ]; then \
		echo "Server container is already running. Stopping and removing it first."; \
		docker stop $(CONTAINER_NAME) > /dev/null; \
		docker rm $(CONTAINER_NAME) > /dev/null; \
	fi
	@docker run -d --name $(CONTAINER_NAME) \
		-p $(PORT):3000 \
		--env-file .env \
		-e DATABASE_URL=$(DATABASE_URL) \
		-e PORT=$(PORT) \
		--link $(DB_CONTAINER_NAME):db \
		$(IMAGE_NAME)
	@echo "Server is running on http://localhost:$(PORT)"
	@echo "Waiting for server to start..."
	@sleep 5

# Stop the server and database containers
.PHONY: stop
stop:
	@echo "Stopping server container..."
	@if [ $$(docker ps -q -f name=^$(CONTAINER_NAME)$$) ]; then \
		docker stop $(CONTAINER_NAME) > /dev/null; \
		docker rm $(CONTAINER_NAME) > /dev/null; \
		echo "Server container stopped and removed."; \
	else \
		echo "Server container is not running."; \
	fi
	@echo "Stopping database container..."
	@if [ $$(docker ps -q -f name=^$(DB_CONTAINER_NAME)$$) ]; then \
		docker stop $(DB_CONTAINER_NAME) > /dev/null; \
		docker rm $(DB_CONTAINER_NAME) > /dev/null; \
		echo "Database container stopped and removed."; \
	else \
		echo "Database container is not running."; \
	fi


# Run integration tests
.PHONY: test
test: run
	@echo "Running integration tests..."
	@docker exec $(CONTAINER_NAME) npm test
	@echo "Integration tests finished."

# Show logs from the server container
.PHONY: logs
logs:
	@echo "Showing logs for $(CONTAINER_NAME)..."
	@docker logs -f $(CONTAINER_NAME)

# Clean up Docker images and containers
.PHONY: clean
clean: stop
	@echo "Removing Docker image $(IMAGE_NAME)..."
	@if [ $$(docker images -q $(IMAGE_NAME)) ]; then \
		docker rmi $(IMAGE_NAME); \
	else \
		echo "Image $(IMAGE_NAME) not found."; \
	fi
	@echo "Removing Docker image $(DB_IMAGE_NAME)..."
	@if [ $$(docker images -q $(DB_IMAGE_NAME)) ]; then \
		docker rmi $(DB_IMAGE_NAME); \
	else \
		echo "Image $(DB_IMAGE_NAME) not found."; \
	fi
	@echo "Docker environment cleaned."

# Add a .env file if it doesn't exist for local development convenience
.PHONY: setup-env
setup-env:
	@if [ ! -f .env ]; then \
		echo "Creating a default .env file..."; \
		echo "PORT=3000" > .env; \
		echo "DATABASE_URL=postgres://testuser:testpassword@localhost:5432/inventorydb" >> .env; \
		echo "X_AUTH_TOKEN=secrettoken" >> .env; \
		echo "ADMIN_TOKEN=secrettoken" >> .env; \
		echo ".env file created. Please review and update it as necessary. Ensure X_AUTH_TOKEN and ADMIN_TOKEN are secure if this is for production."; \
	else \
		echo ".env file already exists."; \
	fi

# Lint the server code
.PHONY: lint
lint:
	@echo "Linting server code..."
	@docker exec $(CONTAINER_NAME) npm run lint
