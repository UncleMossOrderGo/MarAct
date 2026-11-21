# MarAct

Python backend dependencies live in `pyproject.toml` and `uv.lock`. The React frontend, its TypeScript config, and its npm dependencies live under `frontend/`.

A modular monolith starter for comparing hackathon ideas in one app. The React and Vite frontend switches ideas by URL. One Python FastAPI backend runs both modules against PostgreSQL, with a separate set of tables for each idea.

## Local setup

Install Node.js 24, npm, Python 3.12–3.14, uv, Make, and Docker with the Compose plugin. Start Docker, then run:

```sh
make init
OPENAI_API_KEY= IDEA_A_USE_SEED_TRENDS=true IDEA_A_SCHEDULER_ENABLED=1 make dev
```

Open [MarAct on port 5173](http://127.0.0.1:5173). The first visit opens the Idea A fruit marketplace. Use the idea dropdown to compare it with Idea B. The starter API listens on port 3000 and Vite proxies `/api` requests. Adjust `.env` if local ports conflict. Keep `DB_PORT` and the port in `DATABASE_URL` in sync.

| Command | Behavior |
| --- | --- |
| `make init` | Create `.env` if needed, install locked Python and Node dependencies, start PostgreSQL, apply migrations, and seed all demos. Safe to rerun. |
| `make dev` | Start PostgreSQL and both development apps. |
| `make migrate` | Apply pending starter SQL and Alembic revisions to `DATABASE_URL`. |
| `make seed IDEA=idea-b` | Insert that idea’s fixtures once. |
| `make test-idea IDEA=idea-a` | Run the idea’s API and browser suites. |
| `make test-api` | Run the Python API tests with PostgreSQL. |
| `make check` | Run lint, type checks, all idea suites, and the cross-idea browser smoke tests. |
| `make build` | Compile-check Python and build the frontend. Run `make start` to serve them together. |
| `make doctor` | Print runtime and Docker versions and check Docker connectivity. |

Before the first browser test, run `cd frontend && npx playwright install chromium` from the repo root. API tests use `DATABASE_URL`. Browser tests create and remove a disposable PostgreSQL schema with fixed demo fixtures and seed mode with the OpenAI key cleared. Browser tests use port 5174 and API port 3001 by default. Keep these ports free, and set a distinct `DB_PORT` and `DATABASE_URL` when running database environments in parallel.

## Run the marketplace demo

1. Select **Smoothie Café** and continue. Mango ranks first and has two seller offers in the seed fixtures.
2. Open Mango, choose the recommended seller at ฿78.00/kg, set the quantity to 5 kg, and add it to your cart.
3. Continue to checkout and place the order. The saved order shows 5 kg and ฿390.00, calculated by the server.
4. Run a trend check in **Trends** and reopen the order in **Orders**. The saved quantity and total stay the same.

The command under Local setup starts the walkthrough without provider calls. A v1 database upgrades through `make migrate`, then `make seed IDEA=idea-a` loads marketplace fixtures without replacing existing orders or depleted stock. Alembic preserves the old café records and migrates compatible usage forward.

Set `IDEA_A_SCHEDULE_TIME` to a 24-hour Bangkok time in `HH:MM` format. The default is `15:30`. Enable the scheduler on one instance only. Manual and scheduled refreshes use the same service. `IDEA_A_TREND_CACHE_HOURS` defaults to 24. Without a key, trend refresh uses seed cards and feed explanations use templates. CI clears the key, selects seed mode, and disables the scheduler.

Before enabling live search, verify the configured model and domain-filter support with the adapter's stubbed Responses request. Check that the request includes the intended allow-list, then verify that every displayed citation matches returned search evidence. Use prompt steering if filters are unavailable.

To measure the demo targets, warm the shop feed and record repeat feed request timings in the browser Network panel. Measure explanation time from the stream request until its first explanation event. Compare against the targets of 300 ms for cached feed and 3 s for explanations. For a live trial, use a dedicated API project, record the run count and token and search usage, and compare the project spend delta against the $5 PoC target.

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
