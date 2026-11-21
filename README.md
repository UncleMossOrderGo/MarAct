# MarAct

Python backend dependencies live in `pyproject.toml` and `uv.lock`. The React frontend, its TypeScript config, and its npm dependencies live under `frontend/`.

A single fruit marketplace backed by React, Vite, FastAPI, and PostgreSQL. The marketplace owns the catalog, quotes, cart, and checkout. Its shopping assistant reads the same lots and quote rules.

## Local setup

Install Node.js 24, npm, Python 3.12–3.14, uv, Make, and Docker with the Compose plugin. Start Docker, then run:

```sh
make init
make dev
```

Open [MarAct on port 5173](http://127.0.0.1:5173). The first visit opens `/market`. Select **ผู้ช่วยจัดซื้อ** to open the shopping assistant. The API listens on port 3000 and Vite proxies `/api` requests. Adjust `.env` if local ports conflict. Keep `DB_PORT` and the port in `DATABASE_URL` in sync.

| Command | Behavior |
| --- | --- |
| `make init` | Create `.env` if needed, install locked Python and Node dependencies, start PostgreSQL, apply migrations, and seed all demos. Safe to rerun. |
| `make dev` | Start PostgreSQL and both development apps. |
| `make migrate` | Apply pending migrations to `DATABASE_URL`. |
| `make seed IDEA=idea-b` | Insert that idea’s fixtures once. |
| `make test-idea IDEA=idea-a` | Run the idea’s API and browser suites. |
| `make test-api` | Run the Python API tests with PostgreSQL. |
| `make check` | Run lint, type checks, all idea suites, and the cross-idea browser smoke tests. |
| `make build` | Compile-check Python and build the frontend. Run `make start` to serve them together. |
| `make doctor` | Print runtime and Docker versions and check Docker connectivity. |

Before the first browser test, run `cd frontend && npx playwright install chromium` from the repo root. The API and smoke tests use `DATABASE_URL`, so initialize the database first. Browser tests use port 5174 and API port 3001 by default. Keep these ports free, and set a distinct `DB_PORT` and `DATABASE_URL` when running database environments in parallel.

## Marketplace handoff

| Area | Where to work |
| --- | --- |
| Marketplace, shared cart, chat | [`frontend/src/features/marketplace/`](frontend/src/features/marketplace/) |
| Lot ranking and quote rules | [`backend/src/modules/marketplace/catalog.py`](backend/src/modules/marketplace/catalog.py) |
| Partner lots, buyer sessions and confirmed orders | [`backend/src/modules/marketplace/router.py`](backend/src/modules/marketplace/router.py) |
| Chat intent, quotas, proposals and trend matching | [`backend/src/modules/marketplace/copilot.py`](backend/src/modules/marketplace/copilot.py) |

`/ideas/idea-c` redirects to `/market` and preserves query parameters and the cart or orders hash. `/ideas/idea-b` opens Copilot in the marketplace. `/ideas/idea-b/chat`, `/ideas/idea-b/workspace`, and `/ideas/idea-a` remain accessible. Marketplace APIs retain `/api/ideas/idea-c` so existing consumers and buyer sessions continue to work.

`POST /api/ideas/idea-c/copilot/chat` takes a Thai or English `message`, optional `postcode`, `arrival`, `preference`, and `previous` search criteria. It returns `message`, `source`, `lots`, `groups`, `trends`, `tool_calls`, `unfulfilled`, `previous`, and `delivery_confirmed`. Quantities are quoted in whole sales units. The cart budget is a product subtotal. A destination and date are needed to calculate totals with freight. Applying a proposal re-quotes the affected farm carts. The buyer confirms checkout separately.

The agent uses live catalog data from the configured PostgreSQL database. Demo installations can load sample lots with `make seed IDEA=idea-c`. Trend metrics remain sample data. When available, MCP web sources appear as additional cited context. In public-demo mode, guests can use catalog answers and signed-in buyers can use external tools within the configured quotas.

## Add a legacy demo

1. Pick a stable lowercase ID such as `idea-c`. Create a screen and a `*.spec.ts` test under `frontend/src/ideas/idea-c/`.
2. Register its label, status, and screen in [the idea registry](frontend/src/ideas/registry.ts). The screen URL is `/ideas/idea-c`.
3. Create the module and its `test_*.py` test under `backend/src/modules/idea_c/`. Use underscores in the Python package name. Mount its router at `/api/ideas/idea-c` in [the backend app](backend/src/app/main.py).
4. Coordinate the next migration number, add SQL under `backend/db/migrations/`, and prefix idea tables with `idea_c_`. Put repeatable fixtures under `backend/db/seeds/idea-c/` using stable unique seed keys.
5. Run `make migrate`, `make seed IDEA=idea-c`, and `make test-idea IDEA=idea-c`. Record the addition in [CHANGELOG.md](CHANGELOG.md).

A `draft` idea is available by direct link. A `demo` is also selectable from the legacy idea pages. A `retired` idea’s page is unavailable. Preserve IDs and tables through promotion.

## CI and deployment

GitHub Actions routes changes in idea-owned folders to the corresponding suites. Changes to shared inputs trigger all idea suites and the smoke tests. Each test job migrates its own disposable database. Configure branch protection for the aggregate `ci` job. Pushes to `main` also compile-check the backend and build the frontend.

See [infra/README.md](infra/README.md) for the deployment contract and [docs/adr/](docs/adr/) for architecture decisions.
