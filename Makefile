.PHONY: init dev dev-demo dev-live dev-api start migrate seed test-idea test-api check quality build doctor db .env

LIVE_WEB_PORT ?= 5175
LIVE_API_PORT ?= 3002

export IDEA

init: .env
	npm --prefix frontend ci
	uv sync --locked
	$(MAKE) db
	$(MAKE) migrate
	uv run --locked python -m backend.db.manage seed --all

dev: db
	npm --prefix frontend run dev:all

dev-demo:
	OPENAI_API_KEY= IDEA_A_USE_SEED_TRENDS=true IDEA_A_DEMO_TRIGGER_ENABLED=1 $(MAKE) dev

dev-live:
	MARACT_WEB_PORT=$(LIVE_WEB_PORT) API_PORT=$(LIVE_API_PORT) IDEA_A_SCHEDULER_ENABLED=1 IDEA_A_USE_SEED_TRENDS=false IDEA_A_DEMO_TRIGGER_ENABLED=1 $(MAKE) dev

dev-api: .env
	uv run --locked python -m backend.src.app.server --reload

start: .env
	uv run --locked --no-dev python -m backend.src.app.server

.env:
	@test -f .env || cp .env.example .env

db: .env
	docker compose up -d --wait db

migrate: .env
	uv run --locked --no-dev python -m backend.db.manage migrate

seed: .env
	uv run --locked --no-dev python -m backend.db.manage seed $(if $(DOMAIN),--domain "$(DOMAIN)",$(if $(IDEA),--idea "$(IDEA)",--all))

# Compatibility aliases for existing contributor commands.
test-idea: .env
	@case "$(IDEA)" in \
	  idea-a) api=backend/src/modules/shop; web='features/shop/|e2e/shop' ;; \
	  idea-b) api=backend/tests/copilot; web='ShoppingCopilot|workspace' ;; \
	  idea-c) api=backend/tests/marketplace; web='e2e/marketplace' ;; \
	  *) echo 'Use IDEA=idea-a, idea-b, or idea-c'; exit 2 ;; \
	esac; \
	uv run --locked python -m pytest "$$api" && npm --prefix frontend run test:web -- "$$web"

quality:
	uv run --locked ruff check backend
	uv run --locked mypy backend
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck

test-api: .env
	uv run --locked python -m pytest

check: .env quality test-api
	npm --prefix frontend run test:web

build:
	uv run --locked python -m compileall -q backend
	npm --prefix frontend run build

doctor:
	node --version
	npm --version
	uv --version
	docker compose version
	docker info --format '{{.ServerVersion}}'
