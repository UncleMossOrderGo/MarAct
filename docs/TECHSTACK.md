# MarAct — Technical Stack & Architecture

**Project:** AI-powered Farm-to-Business Fruit Marketplace  
**Event:** SEA x OpenAI Hackathon  
**Status:** Proposed team-wide technical decisions (MVP)  
**Last updated:** 2026-11-21  
**Repository:** https://github.com/UncleMossOrderGo/MarAct

> This document distinguishes the **existing repository stack** from **recommended additions**. It is a working agreement for a short hackathon prototype, not a claim that every proposed dependency or integration is already implemented.

## 1. Product scope

A B2B platform where fruit farms list available/upcoming produce and SMEs discover and contact farms directly. The platform gives buyers **more transparent choices**, not an automatic mandate to choose the cheapest seller.

**Core demo journey:** An SME requests a type of fruit, quantity, location/delivery deadline, and preferences → the application retrieves eligible farm listings → the system compares delivered costs and tradeoffs → an AI assistant explains a small set of personalized options → the buyer sends an inquiry/RFQ → a trend panel shows fruit-interest signals with sources and limitations.

**Three MVP workstreams:**
1. **Marketplace & farmer supply:** farm/listing catalog, availability/harvest windows, supplier detail, buyer inquiry (RFQ).
2. **Buyer personalization:** buyer preferences, deterministic matching/ranking, OpenAI-assisted query understanding and grounded explanations.
3. **Social listening & trend intelligence:** curated/authorized signal ingestion, interpretable trend scores, caveated opportunity insights.

**Explicit non-goals:** payment gateway, escrow, order fulfillment, live delivery tracking, production-grade identity/KYC, large-scale scraping, robust causal demand or price forecasting, complex multi-agent orchestration.

## 2. Stack decision table

| Layer | Choice | Status | Why / notes |
|---|---|---|---|
| Frontend | **React 19 + TypeScript 5 + Vite 8** | **Existing** | Maintain the repository's current SPA architecture; do **not** migrate to Next.js during the event. |
| Client routing | **React Router 7** | **Existing** | Current idea selection is URL-driven (`/ideas/idea-b`). |
| UI styling | **CSS / CSS modules (start with existing styles)** | **Recommended** | Minimize churn. Add a UI library only if the team agrees and time allows. |
| Backend API | **Python 3.12+ + FastAPI** | **Existing** | Single backend with per-idea routers. |
| API validation | **Pydantic (via FastAPI)** | **Existing indirectly** | Type request/response bodies and publish OpenAPI docs. |
| Database | **PostgreSQL 17** | **Existing** | Local database through Docker Compose; idea-scoped SQL tables. |
| Database driver | **psycopg 3 + psycopg_pool** | **Existing** | Reuse the repository's DB helpers; no new ORM for MVP. |
| Migrations & seeds | **Repository SQL migration/seed runner** | **Existing** | Append new, uniquely numbered migrations; seed reproducible demo records. |
| AI LLM | **OpenAI API (Responses API / structured outputs or tool calling)** | **Recommended addition** | Query parsing, optional buyer chat, and evidence-grounded explanation; model chosen based on event access, budget and latency. |
| AI orchestration | **Plain Python services + explicit functions/tools** | **Recommended** | One assistant, not LangGraph/CrewAI unless a demonstrable need emerges. |
| Personalization | **Deterministic filter + weighted ranking (Python)** | **Recommended** | Reproducible eligibility and comparison; LLM does not invent suppliers or prices. |
| Trend engine | **Pandas (optional), standard Python + SQL** | **Recommended** | Simple preprocessing, moving averages, growth rates, normalized interest score. |
| Trend data | **Authorized public datasets/APIs or clearly labeled fixtures** | **Recommended** | Prefer CSV/snapshots for reliable demo; no unsupported claims of live signals. |
| Frontend tests | **Playwright** | **Existing** | End-to-end happy path and idea navigation. |
| Backend tests | **pytest + httpx** | **Existing** | Endpoint, ranking, trend-score and fallback tests. |
| Code quality | **ESLint, TypeScript compiler, Ruff, mypy** | **Existing** | `make quality` and `make check`. |
| Package management | **npm (frontend), uv (Python)** | **Existing** | Preserve `package-lock.json` and `uv.lock`. |
| Local run | **Make + Docker Compose** | **Existing** | `make init`, `make dev`. |
| Deployment | **One FastAPI service serving built Vite SPA + API** | **Existing contract, host TBD** | Prefer one HTTPS host to reduce CORS and deployment risk. |
| Monitoring | **Structured app logs / request IDs (basic)** | **Recommended** | No extra observability platform required for MVP. |

### Dependency discipline

- First use existing dependencies. If OpenAI integration is enabled, add the **official `openai` Python SDK** to `pyproject.toml` using `uv` and commit the updated `uv.lock`; coordinate this shared-file edit.
- Avoid adding Redis, Celery, Kafka, vector DB, LangChain, LangGraph, or a new frontend framework to the MVP without a demonstrated blocker.
- If charts are needed, use lightweight SVG/CSS or an approved charting dependency; confirm with the frontend owner before changing `frontend/package.json`.

## 3. Existing repository layout and Idea B conventions

The following is the **current repository baseline**:

```text
MarAct/
├── AGENTS.md                  # Global team/Codex instructions; preserve
├── README.md                  # Setup, commands, module integration
├── Makefile
├── compose.yaml               # postgres:17
├── pyproject.toml             # FastAPI, psycopg, uvicorn + dev tools
├── frontend/
│   ├── package.json
│   └── src/
│       ├── app/               # SPA shell/routing
│       ├── shared/
│       └── ideas/
│           ├── idea-a/
│           ├── idea-b/        # Assigned Idea B workspace
│           │   ├── screen.tsx
│           │   └── screen.spec.ts
│           └── registry.ts
└── backend/
    ├── src/
    │   ├── app/main.py       # Router mounts
    │   ├── shared/
    │   └── modules/
    │       ├── idea_a/
    │       └── idea_b/
    │           ├── router.py
    │           └── test_records.py
    └── db/
        ├── migrations/
        └── seeds/
```

**Recommended additions inside Idea B** (not yet present):

```text
frontend/src/ideas/idea-b/
├── screen.tsx                 # Composition point; integration owner edits
├── marketplace/
├── personalization/
│   ├── RecommendationPanel.tsx
│   ├── BuyerPreferenceForm.tsx
│   └── api.ts
├── social-listening/
│   ├── TrendDashboard.tsx
│   └── api.ts
└── types.ts                  # Agreed UI/API data shapes

backend/src/modules/idea_b/
├── router.py                  # Integration owner edits
├── marketplace/
│   ├── schemas.py
│   └── service.py
├── personalization/
│   ├── schemas.py
│   ├── service.py             # Eligibility + scoring
│   ├── llm.py                 # Optional OpenAI interpreter
│   └── test_personalization.py
└── social_listening/
    ├── schemas.py
    ├── service.py             # Ingest/read signals
    ├── scoring.py             # Deterministic calculation
    └── test_trends.py

backend/db/migrations/      # Numbered SQL changes (coordinate ownership)
backend/db/seeds/idea-b/    # Reproducible Idea B fixtures
```

**Important:** `frontend/src/ideas/idea-b/` is for browser UI, not Python agents or secrets. Keep API/agent logic under `backend/src/modules/idea_b/`. Keep `idea-a` and other team's files untouched.

## 4. System flow

```mermaid
flowchart TD
    B[SME buyer] --> UI[React Idea B SPA]
    F[Farmer] --> UI
    UI --> API[FastAPI /api/ideas/idea-b]
    API --> M[Marketplace services]
    API --> P[Personalization services]
    API --> T[Trend intelligence services]
    M --> DB[(PostgreSQL)]
    P --> DB
    T --> DB
    P --> O[OpenAI API optional]
    T --> O
    S[Authorized signal snapshots / fixtures] --> T
```

- **Marketplace** is the source of truth for farm listings, inventory, delivery terms, and RFQs.
- **Personalization** reads those listings; it must not maintain a conflicting supplier catalog.
- **Trend intelligence** reads source-tagged signal records; it cannot treat social mentions as verified demand, price movement, or expected profit.
- **OpenAI** interprets natural language and explains returned evidence; it is **not** the authoritative store or numerical computation engine.

## 5. Feature specifications

### 5.1 Marketplace (team workstream)

**MVP UI:** searchable catalog, farm profile, fruit type/grade, price per kg, MOQ, location/service area, harvest availability, delivery fee/terms if known, and RFQ action.

**MVP backend:** farm/listing read endpoints and an RFQ-create endpoint. Avoid checkout and payment integration.

**Data model (proposed):** `idea_b_farms`, `idea_b_listings`, `idea_b_rfqs`; each listing has a stable ID, farm ID, fruit type, unit price, stock/availability, MOQ, and last-updated timestamp. If freight or quality is unknown, store null rather than fabricate.

### 5.2 Personalization Agent (assigned owner)

**Inputs:** buyer ID or temporary preference object; fruit, quantity (kg), budget, delivery destination/area, desired date, preferred quality, relationship with known supplier, and optional free-text request.

**Process:**
1. Validate the request and retrieve listings from Marketplace.
2. **Hard-filter** for fruit, MOQ, available supply and required delivery/date constraints where supported.
3. Calculate **landed cost** only from known values (price × quantity + documented shipping/fees). Mark incomplete costs as such; do not rank unknown shipping as free.
4. Rank eligible listings on configurable, explainable weights (cost, delivery fit, freshness/quality evidence, prior relationship). Use neutral defaults and let buyer preference override.
5. Return 3–5 options with **tradeoffs and reasons**, preserving the user's agency (a familiar farm may be reasonable even if more expensive).
6. Optionally use OpenAI to parse a conversational inquiry and explain **only** retrieved results, with tool/structured-output validation.

**Output:** structured shortlist; individual eligibility/score components, pricing completeness, and an explanation. Include a fallback that runs without OpenAI credentials.

**Never:** fabricate farm ratings or supplier trust, claim a price advantage without comparable shipping/quantity, autonomously place an order, or hide a suitable supplier merely because its rank is lower.

### 5.3 Social Listening / Fruit Trend Intelligence (assigned owner)

**MVP signal inputs:** timestamp, fruit/keyword, source (e.g., permitted public trend index or pre-collected/fixture CSV), location/market if known, metric type, raw/normalized value, and provenance. The first version may use honest labeled snapshots.

**Pipeline:** clean/normalize keywords → group by fruit and time window → compute simple growth and moving-average momentum → optional seasonal context → produce trend score and evidence → optional LLM summary grounded in those metrics.

**Output:** fruit, window, score/momentum, sample size, last updated, evidence/source labels, caveat/confidence tier, and one actionable **monitoring** recommendation (not a guaranteed purchase signal).

**Guardrails:**
- Social interest is **not** observed purchase demand; trend movement is **not** guaranteed price movement.
- Do not claim future price changes or stocking profits unless supported by independent, validated datasets.
- No scraping restricted social sites, bypassing access controls, or collecting private posts.
- Never label seeded fixture data as live; display `Demo data` and date/source prominently.
- For perishable fruit, avoid unconditional stockpiling recommendations; consider spoilage, storage, timing and buyer demand.

## 6. Proposed internal API contracts (agree before implementation)

All routes are **proposed**, under the existing prefix `/api/ideas/idea-b` (mounted in the current backend app).

| Method | Path | Owner | Purpose |
|---|---|---|---|
| GET | `/farms` | Marketplace | Filter farms/listings |
| GET | `/listings` | Marketplace | Product discovery |
| POST | `/rfqs` | Marketplace | Buyer inquiry, not payment |
| POST | `/recommendations` | Personalization | Buyer-specific shortlist |
| POST | `/agent/chat` | Personalization | Optional conversational interface |
| GET | `/trends` | Trend Intelligence | Fruit momentum dashboard |
| GET | `/trends/{fruit_id}` | Trend Intelligence | Evidence and time-window details |

**Example** `POST /api/ideas/idea-b/recommendations` request:

```json
{
  "fruit": "mango",
  "quantity_kg": 100,
  "max_budget_thb": 5500,
  "delivery_area": "Bangkok",
  "required_by": "2026-11-28",
  "preferences": {
    "cost": 0.45,
    "reliability": 0.25,
    "quality": 0.20,
    "existing_relationship": 0.10
  }
}
```

**Example response shape** (illustrative, not actual farm data):

```json
{
  "results": [
    {
      "listing_id": "demo-mango-01",
      "farm_id": "demo-farm-01",
      "eligible": true,
      "price_per_kg_thb": 48,
      "shipping_fee_thb": null,
      "total_cost_thb": null,
      "cost_complete": false,
      "ranking_score": 0.76,
      "reasons": ["Matches fruit type and requested quantity"],
      "caveats": ["Shipping charge has not been provided"]
    }
  ],
  "data_mode": "demo"
}
```

**Trend response shape** (illustrative):

```json
{
  "fruit": "mango",
  "window_days": 28,
  "interest_momentum_pct": 18.4,
  "trend_score": 71,
  "confidence": "low",
  "source": "demo_fixture",
  "observed_until": "2026-11-20",
  "data_mode": "demo",
  "disclaimer": "Search/social interest is not verified demand or a price forecast."
}
```

**Schema rules:** numeric prices in THB, quantity in kilograms, ISO 8601 timestamps/dates, nullable unknown costs, stable IDs, explicit `data_mode` (`demo` or `live`) and provenance fields. Use Pydantic on the server and TypeScript interfaces in the client; do not independently invent incompatible shapes.

## 7. Database ownership and collaboration rules

- Prefix project tables with `idea_b_`; do not edit `idea_a_` tables.
- Assign one person to coordinate `backend/src/modules/idea_b/router.py`, `frontend/src/ideas/idea-b/screen.tsx`, and shared dependency files.
- All developers work in separate branches/worktrees and open small PRs. Own **feature folders**, not personal-name folders.
- Give each new migration a unique next number; never rewrite applied migrations. Follow the existing seed runner and use stable fixture keys so seeding is repeatable.
- Confirm the shared catalog schema before building recommendation queries. If unavailable, use a typed adapter and a temporary fixture explicitly labeled `demo`.
- Treat raw customer preferences, purchasing history, and API credentials as private: minimize storage, do not log full prompts containing personal details, and never expose OpenAI keys to browser JavaScript.

## 8. Configuration & runtime

**Existing** `.env.example` variables:

```dotenv
DATABASE_URL=postgres://maract:maract@127.0.0.1:55432/maract
DB_PORT=55432
API_PORT=3000
```

**Suggested additions**, only if used:

```dotenv
OPENAI_API_KEY=                   # backend only; never commit actual value
OPENAI_MODEL=                      # explicitly choose an available model
TREND_DATA_MODE=demo               # demo or live
```

Do not expose `OPENAI_API_KEY` as `VITE_*`. Do not commit production credentials or user/private datasets. `.env.example` contains placeholders only.

**Local setup:**

```bash
make init
make dev
# UI: http://127.0.0.1:5173/ideas/idea-b
# API: http://127.0.0.1:3000/api/health
```

**Verification:**

```bash
make test-idea IDEA=idea-b
make quality
make build
# Before release, integration owner runs:
make check
```

`make init` requires the versions/tools documented in the root README (Node/npm, Python/uv, Docker + Compose, Make). For Playwright, install Chromium once as directed in the README.

## 9. Deployment recommendation

**MVP default:** One deployable FastAPI application serving `/api/*` and the compiled Vite frontend from `frontend/dist/`, attached to a persistent PostgreSQL database. This already matches `infra/README.md`. HTTPS and health-check endpoint `/api/health` are required by the chosen host. Keep secrets on the backend host.

If no public deployment is ready, prioritize a reproducible local demo with seeded data and a pre-recorded fallback walkthrough; do not build a second infrastructure stack just for the demo.

## 10. Test and acceptance checklist

- [ ] Idea B loads without breaking Idea A or idea routing.
- [ ] Marketplace returns seeded listings and accepts a demo RFQ.
- [ ] Personalization filters ineligible listings correctly and ranks deterministically.
- [ ] Personalization explains cost vs. existing supplier relationship and exposes missing delivery/price data.
- [ ] OpenAI failures or absent API key degrade gracefully to deterministic recommendations.
- [ ] Trend calculations have unit tests for zero baselines, missing periods, sparse/no data, and score bounds.
- [ ] Trend UI shows time window, source, last updated, and a conspicuous demo-data label when applicable.
- [ ] End-to-end demo works with stable seeds and without restricted third-party API dependencies.
- [ ] `make test-idea IDEA=idea-b`, `make quality`, and `make build` pass.
- [ ] No secrets in commits, frontend bundles, or browser network calls.

## 11. Priority order for a short hackathon

**P0 — deliverable first:** shared listing schema and fixtures → working catalog + recommendation endpoint → deterministic rank/cost comparison → Idea B screen showing recommendations → runnable tests.

**P1 — differentiator:** trend scoring on documented snapshots → dashboard with evidence → OpenAI explanations or conversational query parsing → RFQ flow.

**P2 — only if time remains:** buyer preference persistence, real-time external APIs, advanced forecasts, multi-agent routing, deployment automation, sophisticated scoring models.

## 12. Decisions to freeze with the team

1. Is all AgriTech work under **Idea B**, or is Idea B only the AI-feature workspace? Assign the integration owner accordingly.
2. Who owns farm/listing schemas and `router.py` mounts? Freeze the API examples above after agreement.
3. Which signal source is legal/available, and which parts of the demo are fixtures?
4. Which accessible OpenAI model and API budget will be used? Choose this at implementation time, not by assumption.
5. Which branch/commit is the final integrated demo, and who runs final tests/deployment?

---

**Implementation principle:** build a small, truthful, reproducible end-to-end procurement workflow rather than a wide feature list with disconnected mock screens.
