PORT     ?= 3000
PGFLAGS   = PGPASSWORD=warehouse psql -h localhost -U warehouse -d warehouse

.PHONY: up down dev logs psql seed inject-failure metrics health reset

up:          ## Start all services (Docker)
	docker compose up --build -d

down:        ## Stop all services
	docker compose down

dev:         ## Run locally with ts-node (requires local postgres)
	npm run dev

logs:        ## Tail structured logs
	tail -f logs/warehouse.log | npx pino-pretty

psql:        ## Open psql console
	$(PGFLAGS)

seed:        ## POST 10 random orders via the API
	node scripts/seed.js

inject-failure: ## Force failure rate to 100% for 10 seconds
	FAILURE_RATE=1.0 node scripts/inject.js

metrics:     ## Pretty-print /metrics
	curl -s http://localhost:$(PORT)/api/metrics | python3 -m json.tool

health:      ## Check /health
	curl -s http://localhost:$(PORT)/api/health | python3 -m json.tool

reset:       ## Drop and recreate the schema (local postgres)
	$(PGFLAGS) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(PGFLAGS) -f sql/001_schema.sql

help:        ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
