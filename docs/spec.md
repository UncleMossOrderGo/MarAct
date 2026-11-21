# MarAct Idea A — Daily trends to ingredient orders

Draft implementation plan for the hackathon PoC · Target branch `feat/idea-a`.

## Product and demo

Every morning, a food-business owner opens MarAct, finds relevant Thai food trends, sees what to make, and orders the ingredients. The default is **Today’s Trends** for **Bakery** at `/ideas/idea-a`. The journey is Today’s Trends → Trend Details → Recommended Ingredients → Cart → Place Order → Order History. A shop switcher supports seeded bakeries, cafés, and juice shops. The PoC opens directly with no login or separate shop-selection page. These updated briefs supersede the earlier login and fruit-feed design.

The live job discovers changing trends. The deterministic walkthrough uses Pistachio Gelato as a seeded fallback: read evidence and menu idea, edit pistachio paste to 5 kg, add the available ingredients, place a mock order, and find the quantities, server total, and related trend in Orders. Replaying checkout returns the same order. Running the trend job again leaves that order unchanged.

## Experience

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Today’s Trends | Sidebar, compact Bakery header, last update, featured trend with photo, badges, menu idea and sources, ingredient rows and two more trends | Compact header and bottom navigation, one-column hero and cards, clear Order Ingredients action |
| Trend Details | Trend evidence and menu idea beside or above an ingredient list with seller alternatives, whole-kg controls and Add All to Cart | Trend photo and Overview/Ingredients tabs, compact ingredient rows, sticky primary action |
| Marketplace | Search, category filters, photo-based ingredient grid with price, supplier, availability and add action, plus product detail | Two columns where space allows, tappable category controls and focused product detail |
| Cart and checkout | Review seller, quantities, prices, removals and total before Place Order | Full-height cart, sticky total and Place Order action with safe-area spacing |
| Order confirmation and history | Confirmation, saved item details, status, time, total and related trend | Mascot success state, View Order, Back to Trends, and readable order cards |
| Settings | Active shop name/category, language, recent purchases, and last trend update | Same content with compact navigation and controls |

Follow the supplied UX reference with Inter, Lucide, 8 px spacing, 12 px card radius, 10 px button radius, white surfaces, green `#237A32`, light green `#EAF5E5`, border `#E5E7EB`, and text `#171717` / `#6B7280`. Reuse the existing green-cap mascot for branding, empty states, and order success. Use real-looking supplier photos for ingredient products. Ship Thai by default with an English toggle. Keep copy, dates, units, THB and text layout appropriate to the active locale. The seed pack supplies localized demo wording, with a readable source-language fallback for live text.

Show shell and content-shaped skeletons on an initial load or reload. During a refresh, keep the last usable result visible with its timestamp. A failed first load offers retry, and a successful empty result has a distinct empty state. Keep unmatched ingredients visible as “Not on MarAct yet” or its Thai equivalent. Add All includes eligible lines only and tells the user what was omitted. Buttons and steppers must work with keyboard and touch. There is no standalone loading page.

## Repository assessment and architecture

Keep React, TypeScript, Vite, FastAPI, Pydantic, SQLAlchemy, Alembic, PostgreSQL, Docker Compose, Make, and GitHub Actions. Reuse the current Idea A shell styles, design tokens, mascot, cart state, quantity controls, checkout, order read seams, browser fixtures, and Idea B isolation setup. The current branch opens a sign-in gate then a marketplace feed, streams per-feed explanations, and still defaults scheduling to 15:30. Replace that wiring with a Bakery-first saved Today view, independent ingredient catalog, and 06:00 daily job. Remove superseded public authentication and per-page AI routes at cutover. Do not change Idea B.

Keep discovery, ingredient extraction, category matching, Python ranking, job publication, catalog, and order transactions separate. The backend uses the OpenAI Python SDK, Responses API, Structured Outputs, and built-in web search. No page read or language change invokes OpenAI. All AI work happens inside the daily job.

## Daily trend job

See the [daily publication ADR](adr/0004-publish-daily-ingredient-recommendations.md).

Run the same `run_daily_trend_job(trend_date)` at **06:00 Asia/Bangkok**, from the demo control, or from a token-protected platform cron endpoint. Prefer APScheduler in a single FastAPI worker unless the chosen host provides cron. Set the schedule, model, public demo control, seed mode and trend cap from server configuration. Keep job tokens and OpenAI credentials on the server.

1. Discover up to five Thai food, dessert, and drink trends in one Responses web-search call. Pass the current Bangkok date explicitly and request evidence from the preceding seven days. Validate supporting URLs against tool evidence and capture available dates/titles. Keep the allow-list optional until validated.
2. Extract up to six ingredients per trend in one batched structured call. Python normalizes and matches names against Thai and English catalog names and aliases. Keep unmatched names and log them.
3. Run one batched fit call per shop category, for bakery, café and juice shop. Require fit at least 0.4. Save a short rationale, one menu idea, and up to three stock-first ingredients per kept insight. Use seeded fallbacks for known slugs if extraction or matching fails and skip unresolved items.
4. Compute trend score as `clamp(0.6 × confidence + 0.4 × min(distinct_mentions, 5) / 5, 0, 1)`. Trend rank is fit × trend score plus 0.2 for new rising trends or 0.1 for other rising trends. A slug is new if it did not occur in the prior seven Bangkok dates. Use observed support when classifying momentum. With comparable dated observations, use at least +20% for Rising, at most −20% for Fading, and Peak in between. When coverage is sparse use the validated qualitative label with its evidence, without displaying invented percentages.
5. Score eligible listings as `0.6 × trend_rank + 0.25 × normalized 7-day usage + 0.15 × inverse normalized same-ingredient price`. Exclude inactive or unavailable offers, break ties with stable IDs, keep the best and one alternate seller. Suggest ceiling of average daily kg or 2 kg without history, then cap the cart control at available stock and 500 kg. Persist the top three trends and up to three ranked ingredient recommendations per shop. Generate card text from saved category insight and Python-calculated facts.
6. Publish one coherent snapshot per Bangkok date. An explicit run can replace that date’s result atomically, with concurrent invocations coalesced. If discovery fails, takes over 60 seconds, or yields zero usable trends, try seed data. If no usable snapshot can publish, retain the last usable run and show its actual date. Keep orders independent of trend snapshots and refreshes.

Default model is configurable as `gpt-6-luna` per the search spec. Use low effort for discovery and fit and none for extraction. Plan for five calls per complete job and zero per page load. The $0.05 run estimate and model/tool compatibility are to be verified before live deployment. Demo and CI support seed-only runs without a provider key.

## Storage and interfaces

Keep all new data Idea A-owned in shared PostgreSQL. Extend the existing Alembic history without rewriting applied revisions. Shops have category, ingredients have multilingual names, aliases, category and kg unit, and sellers have listings with stock and money. Store seven days of shop/ingredient usage. Save daily run, trend evidence, ingredient matches, category insights, and per-shop recommendations. Checkout records snapshot prices, quantities, and optional trend attribution. Use client-side cart state per shop.

| API under `/api/ideas/idea-a` | Purpose |
| --- | --- |
| GET `/shops` | Seeded shop list, with Bakery default |
| GET `/shops/{shop_id}/today` | One saved home payload including timestamp, trends and ingredient offers |
| GET `/trends/today` | All saved trends with evidence and availability |
| GET `/listings?ingredient_id=&q=&category=` | Searchable ingredient offers and per-ingredient product detail |
| POST `/jobs/daily-trend` | Restricted trigger for the scheduler host or trusted operator |
| POST `/jobs/daily-trend/demo` | Same-origin demo control, enabled only in demo configuration |
| GET `/jobs/daily-trend/latest` | Current attempt and last usable run metadata |
| POST `/orders` | Place or replay a mock order |
| GET `/orders/{order_id}` | Saved order details |
| GET `/shops/{shop_id}/orders` | Shop order history, also used in Settings |

Validate UUID checkout keys, active listings and whole quantities from 1–500 within available stock. Compute THB totals and decrement stock once in a transaction with stable lock order. Preserve the price and optional trend attribution even if a listing or trend later changes. A cart line without a trend is valid. Keep API credentials and job token out of the browser. The demo trigger is off by default, ignores cross-origin writes, and uses a server-side run limit plus in-flight coalescing.

## Verification and roadmap

Begin independent backend, frontend, and infrastructure slices against fixed contract fixtures. Merge schema, job pipeline, and API adapters, wire the new shell and saved Today view, then run the deterministic walkthrough and visual review. Run `make test-idea IDEA=idea-a` and shared checks for migration or app wiring. Verify job evidence and fallbacks with provider stubs, ranking with pure Python tests, read-only page requests with network assertions, and checkout serialization with PostgreSQL. Review screenshots of the actual implementation at 1440px desktop and mobile before signing off.

Open decisions are the final Thai domain allow-list, the full catalog and source/image rights, whether the host uses platform cron, and retention of legacy data. Preserve existing orders and legacy data during cutover. Payments, logistics, vendor UI, push notifications, external trend vendors, and embeddings remain outside this PoC.
