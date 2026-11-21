# AGENTS.md — MarAct Idea B: Buyer Intelligence

## Mission
Build a hackathon-ready **buyer-facing AI intelligence prototype** for the MarAct AgriTech farm-to-business fruit marketplace. This work belongs to **Idea B**, not Idea A. Own two cohesive features:

1. **Personalization / Supplier Discovery:** help SME buyers discover and compare fruit farms based on their own priorities (price, delivery, quantity, quality, trust, and prior supplier relationships). Never silently choose or purchase on their behalf.
2. **Social Listening / Fruit Trend Intelligence:** surface emerging fruit interest signals and explain what they may mean for procurement. Do not present social buzz as proven demand, or imply that it guarantees future price increases.

The demo must make these features useful to an SME buyer and interoperable with the rest of the marketplace. Prefer one end-to-end user journey over multiple unfinished AI features.

## Existing repository: inspect before changing code
- Repo: `UncleMossOrderGo/MarAct`; respect the existing **root `AGENTS.md`** and `README.md`.
- Frontend: React 19 + TypeScript + Vite. Current Idea B entry: `frontend/src/legacy/workspace/screen.tsx`; test: `frontend/tests/e2e/workspace.spec.ts`.
- Frontend registry: `frontend/src/legacy/registry.ts` already registers `idea-b`; route: `/ideas/idea-b`.
- Backend: Python FastAPI with PostgreSQL. Idea B module: `backend/src/modules/copilot/`; legacy router: `backend/src/legacy/workspace/router.py`, currently mounted at `/api/ideas/idea-b` in `backend/src/app/main.py`.
- Root development commands (see README): `make init`, `make dev`, `make check`, `make check`.
- Treat these as observations from the starter repo, not a substitute for inspecting the current branch; adjust to actual files if they have changed.

## Ownership and collaboration boundaries
- Primary frontend ownership: `frontend/src/legacy/workspace/`.
- Primary backend ownership: `backend/src/modules/copilot/`.
- Tests for these modules live alongside their respective modules.
- Coordinate with the team's integration owner before changing `frontend/src/legacy/registry.ts`, `backend/src/app/main.py`, `frontend/src/shared/`, `backend/src/shared/`, `pyproject.toml`, lockfiles, root `AGENTS.md`, or shared configuration.
- For SQL changes, coordinate the unique migration number, prefix all Idea B tables `idea_b_`, and put fixtures under `backend/db/seeds/idea-b/`. Do not mutate migrations already applied by teammates.
- Do not modify any Idea A files. Use an `idea-b` feature branch/worktree and keep commits scoped.
- Do not remove the starter `/records` functionality or tests without first verifying with the integration owner that it is safe to retire them.

## Suggested internal organization (create only as needed)
```text
frontend/src/legacy/workspace/
  screen.tsx
  components/
  personalization/
  social-listening/
  api/
  screen.spec.ts

backend/src/modules/copilot/
  router.py
  personalization/
    schemas.py
    ranking.py
    service.py
    agent.py          # optional LLM explanation/tool orchestration
  social_listening/
    schemas.py
    scoring.py
    service.py
    sources.py        # optional, only when an allowed data source exists
  test_*.py
```
Avoid needless abstractions. Use typed interfaces / Pydantic schemas at API boundaries. Reuse existing repo practices where possible.

## Minimum API contracts (proposed; coordinate with teammates)
All endpoints must be nested under the **existing** `/api/ideas/idea-b` router. Preserve any existing endpoints.

### POST `/api/ideas/idea-b/recommendations`
Request example:
```json
{
  "buyer_id": "demo-cafe-1",
  "fruit": "mango",
  "quantity_kg": 100,
  "delivery_by": "2026-12-01",
  "preferences": {
    "price_weight": 0.45,
    "quality_weight": 0.25,
    "reliability_weight": 0.20,
    "relationship_weight": 0.10
  }
}
```
Response should include a ranked set of farm options with `farm_id`, `farm_name`, `unit_price_thb`, `estimated_shipping_thb` (or null if unknown), `total_cost_thb` (or null if incomplete), `availability`, `score`, and short `reasons` and `tradeoffs`. Return source/provenance and clearly identify missing fields. The weights above are demo examples, not universal defaults. Do not invent shipping, stock, quality, or reliability facts.

### GET `/api/ideas/idea-b/trends?fruit=mango`
Response should contain time-stamped trends including `fruit`, `observed_period`, `signals`, `score`, `trend_label`, `sources`, `data_status` (`demo` or `observed`), `explanation`, and `limitations`. If a confidence measure is not calibrated, do not call it statistical confidence; use a transparent `signal_quality` or omit it.

### Optional POST `/api/ideas/idea-b/agent/chat`
Add only **after** the recommendation and trend endpoints work. Use tool calling only if it helps the user journey. The LLM may translate buyer intent into structured filters and explain tool results, but must not fabricate supplier facts or scores.

## Personalization design rules
- Apply **hard filters** for fruit type, quantity/minimum order, available delivery date, and any explicit buyer constraints before ranking.
- Rank only feasible suppliers. Separate deterministic price calculation, normalized feature scoring, and human-readable explanation.
- Calculate disclosed `total_cost = quantity * unit_price + known shipping + known fees`; distinguish estimated vs verified cost. Do not treat missing shipping as free.
- Make ranking understandable and editable through user preferences. Show familiar farm options alongside newly discovered ones rather than hiding incumbents.
- Respect agency: AI recommends and explains; buyer chooses supplier and initiates contact/RFQ. No autonomous purchases.
- In data-sparse demos, use transparent seeded examples with realistic boundaries and labels; do not invent reviews or performance histories as real observations.

## Social listening design rules
- Separate **observed interest signals** (search volume index, mentions, growth rates) from **inferred demand** and **forecasted price**. An interest increase is not a proven increase in orders.
- Prefer accessible licensed/public data or clearly labeled local demo fixtures. Never scrape restricted sites or bypass platform controls.
- Store source, collection time, observation window, geographic scope, and metric definition. Normalize unlike metrics before combining them.
- Start with simple reproducible feature calculations (e.g., week-over-week interest change and rolling average); document any heuristic weighted trend score.
- Show insufficient data states. Do not claim predictive accuracy without backtesting on an appropriate ground-truth target.
- Procurement insights should mention perishability, seasonality, lead time, inventory risk, and uncertain market effects. Avoid unconditional stockpiling recommendations.
- OpenAI can summarize evidence and explain trends, but numeric trend features should be produced by deterministic code.

## AI / security / reliability
- Keep OpenAI API calls on the **backend**; read credentials from environment variables. Never expose secrets in React, logs, screenshots, or committed files.
- Use the project-standard Python stack and existing dependencies first. Introduce new libraries only if needed; coordinate shared dependency files.
- Validate all API input; handle empty results, unavailable model/API, invalid date or amount, and data-source outages gracefully.
- Provide a deterministic local fallback so the prototype still demos without a live third-party data source or OpenAI service. Clearly label fallback output.
- Avoid broad, uncontrolled agent loops, unnecessary multi-agent frameworks, and unnecessary external integrations.
- Maintain source attribution and distinguish observed, derived, generated, and synthetic content in the UI.

## Delivery order
1. Inspect current Idea B files, relevant root documentation, schemas, and API/test patterns. State your brief implementation plan.
2. Agree on typed supplier/buyer/trend data contracts with existing marketplace interfaces; if unavailable, build adapters using local fixtures and document assumptions.
3. Implement **deterministic supplier filtering and cost ranking** plus backend tests.
4. Add the recommendation endpoint and a simple buyer-facing comparison UI.
5. Implement trend feature scoring from reproducible fixtures, its endpoint, and a small trend panel.
6. Integrate optional OpenAI natural-language interpretation/explanations *after* the basic endpoints work.
7. Run relevant tests/builds; fix failures caused by your work. Document what is real vs simulated, what remains stubbed, and any integration changes needed.

## Acceptance criteria
- `/ideas/idea-b` renders without breaking the existing React/Vite app.
- A demo SME can select a fruit and requirements and see **more than one** candidate farm with transparent ranking reasons and trade-offs.
- Existing suppliers can remain visible even when other suppliers are cheaper.
- The trend panel displays at least one labeled time-window and defensible supporting signals; no unsupported price/demand prediction claims.
- All visible supplier/trend results derive from explicit fixtures or traceable data, not hard-coded LLM claims.
- Frontend and backend agree on response schemas; the original `/api/ideas/idea-b` namespace remains intact.
- Relevant unit/browser tests are present and `make check` passes, or blockers are stated precisely.
- The final Codex handoff lists changed files, endpoints, commands tested, limitations, and any required teammate coordination.

## Codex operational instruction
Before coding, read this file **and the root AGENTS.md + README.md**. Inspect the live repository rather than assuming the suggested folders exist. Work only in the assigned Idea B scope by default. Start with a working vertical slice. If shared files require modification, explain the exact small diff and get team coordination before applying it. Do not replace existing patterns with an entirely new stack.
