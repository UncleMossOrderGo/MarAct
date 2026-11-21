.PHONY: init dev dev-api start migrate seed test-api check quality build doctor db .env

export IDEA

init: .env
	npm --prefix frontend ci
	uv sync --locked
	$(MAKE) db
	$(MAKE) migrate
	uv run --locked python -m backend.db.manage seed --all

dev: db
	npm --prefix frontend run dev:all

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
