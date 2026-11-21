# MarAct

Python backend dependencies live in `pyproject.toml` and `uv.lock`. The React frontend, its TypeScript config, and its npm dependencies live under `frontend/`.

A modular monolith starter for comparing hackathon ideas in one app. The React and Vite frontend switches ideas by URL. One Python FastAPI backend runs both modules against PostgreSQL, with a separate set of tables for each idea.

## Local setup

Install Node.js 24, npm, Python 3.12–3.14, uv, Make, and Docker with the Compose plugin. Start Docker, then run the seed-only demo:

```sh
make init
make dev-demo
```

Open [MarAct on port 5173](http://127.0.0.1:5173). Idea A opens Today’s Trends for MarAct Bakery, its single buyer store. Use the idea dropdown to compare it with Idea B. The starter API listens on port 3000 and Vite proxies `/api` requests. Adjust `.env` if local ports conflict. Keep `DB_PORT` and the port in `DATABASE_URL` in sync.

| Command | Behavior |
| --- | --- |
| `make init` | Create `.env` if needed, install locked Python and Node dependencies, start PostgreSQL, apply migrations, and seed all demos. Safe to rerun. |
| `make dev` | Start PostgreSQL and both development apps. |
| `make dev-demo` | Start the local seeded demo with the Run daily job button enabled. The daily job uses saved fixtures. |
| `make dev-live` | Start the live app on 5175 and API on 3002, with the 06:00 Asia/Bangkok job enabled while the server runs. Configure the OpenAI key in `.env`. |
| `make migrate` | Apply pending starter SQL and Alembic revisions to `DATABASE_URL`. |
| `make seed IDEA=idea-b` | Insert that idea’s fixtures once. |
| `make test-idea IDEA=idea-a` | Run the idea’s API and browser suites. |
| `make test-api` | Run the Python API tests with PostgreSQL. |
| `make check` | Run lint, type checks, all idea suites, and the cross-idea browser smoke tests. |
| `make build` | Compile-check Python and build the frontend. Run `make start` to serve them together. |
| `make doctor` | Print runtime and Docker versions and check Docker connectivity. |

Before the first browser test, run `cd frontend && npx playwright install chromium` from the repo root. API tests use `DATABASE_URL`. Browser tests create and remove a disposable PostgreSQL schema with fixed demo fixtures and seed mode with the OpenAI key cleared. Browser tests use port 5174 and API port 3001 by default. Keep these ports free, and set a distinct `DB_PORT` and `DATABASE_URL` when running database environments in parallel.

## Run the daily ingredient demo

1. Open Idea A. Today’s Trends opens for MarAct Bakery in Thai. Use Settings to switch to English.
2. Open **Pistachio Gelato**, review its sources and menu idea, and open **Order Ingredients**.
3. Set pistachio paste to 5 kg and add the eligible ingredients. Place the mock order for **฿5,495.00** at the seeded prices.
4. Open **Orders** to see the saved quantities and related trend. Try **Run daily job** on Today’s Trends. The saved order keeps its price, quantities, and trend label.

For an existing clone, run `make migrate && make seed IDEA=idea-a` before restarting the app. The new Alembic revision retains existing order IDs and totals. Reseeding preserves previous orders and depleted stock.

The seed-only command uses no OpenAI calls. With live mode enabled, page reads still use saved SQL snapshots. To run live search and assistant chat locally, set `OPENAI_API_KEY` in the server's `.env` and run:

```sh
make dev-live
```

Open [the live Idea A demo](http://127.0.0.1:5175/ideas/idea-a). Use **Run daily job** to update the saved trends, or **Ask agent** to send a chat message. Sourced trend photos appear when supported publishers provide a usable preview. Ingredient listings and simulated PromptPay use demo supplier data.

The model and trend cap are configurable via `OPENAI_MODEL` and `IDEA_A_DAILY_TREND_CAP`. Missing credentials or unusable discovery falls back to the demo trends. Verify the configured model's tool support, source quality, and costs before deployment.

For a deployed job, configure the [token-protected Bangkok host cron](docs/idea-a-daily-trigger.md). Leave the public demo trigger disabled in live deployment. For a single local API worker, `IDEA_A_SCHEDULER_ENABLED=1` enables the in-process 06:00 Bangkok schedule. Use one scheduling method per environment.

## Add an idea

1. Pick a stable lowercase ID such as `idea-c`. Create a screen and a `*.spec.ts` test under `frontend/src/ideas/idea-c/`.
2. Register its label, status, and screen in [the idea registry](frontend/src/ideas/registry.ts). The screen URL is `/ideas/idea-c`.
3. Create the module and its `test_*.py` test under `backend/src/modules/idea_c/`. Use underscores in the Python package name. Mount its router at `/api/ideas/idea-c` in [the backend app](backend/src/app/main.py).
4. Coordinate the next Alembic revision under `backend/db/alembic/versions/` and prefix idea tables with `idea_c_`. Put repeatable fixtures under `backend/db/seeds/idea-c/` using stable unique seed keys.
5. Run `make migrate`, `make seed IDEA=idea-c`, and `make test-idea IDEA=idea-c`. Record the addition in [CHANGELOG.md](CHANGELOG.md).

A `draft` idea is available by direct link. A `demo` is also selectable. A `retired` idea’s page is unavailable. To promote an idea, set it to `demo`, update `defaultIdeaId`, keep the previous default at `demo`, and update the changelog. Preserve IDs and tables through promotion.

## CI and deployment

GitHub Actions routes changes in idea-owned folders to the corresponding suites. Changes to shared inputs trigger all idea suites and the smoke tests. Each test job migrates its own disposable database. Configure branch protection for the aggregate `ci` job. Pushes to `main` also compile-check the backend and build the frontend.

See [infra/README.md](infra/README.md) for the deployment contract and [docs/adr/](docs/adr/) for architecture decisions.
