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
| `make seed DOMAIN=workspace` | Insert that idea’s fixtures once. |
| `make test-api` | Run the Python API tests with PostgreSQL. |
| `make check` | Run lint, type checks, all idea suites, and the cross-idea browser smoke tests. |
| `make build` | Compile-check Python and build the frontend. Run `make start` to serve them together. |
| `make doctor` | Print runtime and Docker versions and check Docker connectivity. |

Before the first browser test, run `cd frontend && npx playwright install chromium` from the repo root. The API and smoke tests use `DATABASE_URL`, so initialize the database first. Browser tests use port 5174 and API port 3001 by default. Keep these ports free, and set a distinct `DB_PORT` and `DATABASE_URL` when running database environments in parallel.

## Buyer and grower journeys

- `/market` searches orderable marketplace lots and public grower listings. Orderable lots use the existing PostgreSQL quote and checkout rules. Grower announcements display their published price, stock and service area. Prices and freight are never copied into checkout by matching a farm name.
- `/trends` compares fruit signals, shows the observation period and sources, and carries the selected fruit into market search or an editable Copilot question.
- `/login` signs a grower in with a password or a one-time code from LINE. `/farmer` opens the local Farmer Studio. Web and LINE share the same private draft. Confirmation publishes to `/farms` and the public grower section on `/market`. Farmer data uses the existing SQLite workspace and photo directory; keep that directory on persistent storage. See [Farmer and LINE setup](backend/src/modules/farmer/README.md).

## Marketplace handoff

| Area | Where to work |
| --- | --- |
| Marketplace and shared cart | [`frontend/src/features/marketplace/`](frontend/src/features/marketplace/) |
| Lot ranking and quote rules | [`backend/src/modules/marketplace/catalog.py`](backend/src/modules/marketplace/catalog.py) |
| Partner lots, buyer sessions and confirmed orders | [`backend/src/modules/marketplace/router.py`](backend/src/modules/marketplace/router.py) |
| Chat intent, quotas, proposals and trend matching | [`backend/src/modules/copilot/router.py`](backend/src/modules/copilot/router.py) |

`/ideas/idea-c` redirects to `/market` and preserves query parameters and the cart or orders hash. `/ideas/idea-b` opens Copilot in the marketplace. `/ideas/idea-b/chat`, `/ideas/idea-b/workspace`, and `/ideas/idea-a` remain accessible. Marketplace APIs retain `/api/ideas/idea-c` so existing consumers and buyer sessions continue to work.

`POST /api/ideas/idea-c/copilot/chat` takes a Thai or English `message`, optional `postcode`, `arrival`, `preference`, and `previous` search criteria. It returns `message`, `source`, `lots`, `groups`, `trends`, `tool_calls`, `unfulfilled`, `previous`, and `delivery_confirmed`. Quantities are quoted in whole sales units. The cart budget is a product subtotal. A destination and date are needed to calculate totals with freight. Applying a proposal re-quotes the affected farm carts. The buyer confirms checkout separately.

The agent uses live catalog data from the configured PostgreSQL database. Demo installations can load sample lots with `make seed DOMAIN=marketplace`. Trend metrics remain sample data. When available, MCP web sources appear as additional cited context. In public-demo mode, guests can use catalog answers and signed-in buyers can use external tools within the configured quotas.


The chat UI lives in `frontend/src/features/copilot/`. API tests live in `backend/tests/` and browser journeys in `frontend/tests/e2e/`. CI runs backend, frontend, and browser checks for every change. See [the product structure](docs/adr/0003-product-structure.md) and [deployment instructions](infra/README.md).
