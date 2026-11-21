# MarAct Idea A — B2B fruit marketplace

Draft for the hackathon PoC · 2026-11-21 · Supersedes café restocking v1.

## Problem Statement

Food businesses need to choose which fruit to buy and from which supplier. A generic catalog gives shop owners little context about what fits their menu, what they already use, or what is gaining attention in Thailand.

## Solution

Idea A gives a demo buyer a shop-specific marketplace feed, a cached view of Thai web and social buzz, and a mock order flow. Python ranks listings, determines suggested quantities, calculates prices, and writes orders. OpenAI gathers trend evidence and explains recommendations. Sellers are seeded suppliers with prices and stock.

## User Stories

1. As a buyer, I want to choose a demo shop so my feed reflects the business I am buying for.
2. As a buyer, I want to switch shops so I can compare recommendations for different menus.
3. As a buyer, I want to inspect the active shop’s menu tags so I can understand its feed.
4. As a buyer, I want to see recommended fruits ordered by relevance so I can decide what to buy.
5. As a buyer, I want to know why each recommendation fits my shop so I can judge it.
6. As a buyer, I want a suggested quantity based on recent usage so I can start from a sensible amount.
7. As a buyer, I want to see recent Thai web and social buzz so I can identify emerging demand.
8. As a buyer, I want source links and a live or cached indicator so I can judge freshness and credibility.
9. As a buyer, I want to run a trend check so I can refresh the evidence when needed.
10. As a buyer, I want to compare seller prices and stock for one fruit so I can choose a listing.
11. As a buyer, I want to edit whole kilograms and add the listing to my cart so I can assemble an order.
12. As a buyer, I want to edit or remove cart items so I can correct my order before checkout.
13. As a buyer, I want to review the total and place an order so I can save the purchase in the app.
14. As a buyer, I want stock or listing errors shown beside my checkout so I can correct the cart.
15. As a buyer, I want checkout retries to return the same order so a network failure cannot duplicate the purchase.
16. As a buyer, I want confirmation and order history so I can recover the saved quantities and prices later.
17. As a buyer, I want my cart and orders scoped to my shop so switching shops does not mix their purchases.
18. As a demo operator, I want seeded trends and template explanations so I can run the walkthrough without OpenAI.
19. As a demo operator, I want the schedule and button to share the trend workflow so the manual demo reflects the scheduled behavior.
20. As a developer, I want deterministic fixtures and a stubbed SDK in CI so tests run without production secrets.
21. As a buyer, I want to sign in before choosing a shop so that marketplace access is limited to demo participants.
22. As a buyer, I want to sign out when I finish so that the next person sees the sign-in screen.

## Implementation Decisions

### Product flow and design

Start with a MarAct-themed email and password screen for signed-out buyers. After sign-in, use the attached image as the reference for the sequence **Choose shop → Marketplace → Product detail → Cart → Checkout → Orders**. Keep shop choice in the onboarding screen and a switcher in the marketplace header. The left navigation covers Marketplace, Trends, Orders, and Shop Profile, and collapses for small screens. Surface the trend strip on Marketplace and allow Trends to show the full cards. Show a cart drawer on wide screens and a dedicated cart view where space is limited. Place order from the checkout summary, then open the saved order with its confirmation and offer a route to order history.

Use existing MarAct colors, typography, surface treatments, controls, and focus patterns. Use the reference’s hierarchy, fruit photography, card grid, seller comparison, and order summary as layout guidance. Use MarAct branding and accessible controls. Search, favorites, and image galleries shown in the reference are visual cues outside the MVP. English ships by default. Thai names are available in the catalog and explanation locale is explicit, so a Thai toggle can be added later.

### Architecture and data

Keep the Idea A slot and route prefix, React/TypeScript/Vite, Python/FastAPI/Pydantic/SQLAlchemy/Alembic, shared PostgreSQL, Docker Compose, Make, and GitHub Actions. Keep the OpenAI stub in CI and use the Python SDK and Responses API. Use one shared, server-configured buyer login with an expiring signed session cookie. The session opens Idea A. Signed-in buyers may switch among all seeded shops. Registration, password reset, and per-shop roles are out of scope.

Use the `idea_a_` prefix for shops, usage, fruits, sellers, listings, trend runs, trends, recommendations, orders, and order items. Seed Smoothie Café, Bakery, Café, three suppliers, multiple fruits and listings, and seven days of per-shop use as the purchase-history signal. Seed menu tags. A globally unique order idempotency key resolves retries to their original order. Successful checkout snapshots server prices and quantities and decrements available stock atomically. Trends never modify orders.

Append a migration after the existing restocking revision. Map seeded café usage into the marketplace shop/catalog model where applicable. Preserve legacy restocking data during the demo migration until its retention is explicitly decided, and remove v1 screens and endpoints at marketplace cutover. Idea B is unchanged. See the [pivot ADR](adr/0003-pivot-idea-a-to-fruit-marketplace.md).

### Trend workflow

The manual action and daily Bangkok scheduler call one refresh service. Pass the current Bangkok date explicitly, region TH, a seven-day lookback, and the fruit catalog to one Responses request with built-in `web_search`. Request `web_search_call.action.sources`. Use a small Thai-domain allow-list only after validating it. Otherwise steer by prompt. Accept up to five mapped fruit cards with a trend name, up to two rationale sentences, up to three menu ideas, confidence in [0,1], and supporting URLs. Drop unmapped cards. Resolve sources against returned search evidence and count distinct supported sources in Python.

Compute `clamp(0.6 × confidence + 0.4 × min(mention_count, 5) / 5, 0, 1)`. Cache and deduplicate refreshes within the configured window. Use seed trends on timeout, provider error, missing credentials, zero valid cards, or explicit seed mode. Cap provider wait at 30 seconds and label fallback results “Showing cached trends.” Label the feature **Web & social buzz**. The demo uses prefetched or seeded cards.

### Personalized feed and explanations

Rank active in-stock listings using `(0.35 × history + 0.25 × profile + 0.30 × trend + 0.10 × value) × stock_ok`. History is the shop’s seven-day fruit usage normalized across fruits, profile is the fraction of shop menu tags matched by the fruit, and value is inverse normalized price among eligible listings for that fruit. Stock factor is 1 when available stock meets the suggestion, otherwise 0.5. Suggested kilograms are the ceiling of average daily usage, or 2 kg with no fruit history and trend score above 0.5. Use 0 when there is no usage and the trend threshold is unmet. Show up to five fruits and two seller choices per fruit. Break ties by higher trend, lower price, then stable IDs. Keep weights in one Python configuration.

Show the ranked feed immediately with templates. Stream one batched explanation result separately and cache it. Request one explanation per recommendation of at most 25 words in the requested locale. Give the model the computed score, trend, quantity, seller, and price. Validate output and preserve Python values. Template format is “{fruit} fits your {menu_tag} menu{, trending: {trend_name}}. Suggested {kg} kg from {seller} at ฿{price}/kg.” Use neutral wording when there is no matching tag. A zero suggestion remains informational and the cart quantity must be at least 1 kg.

### Backend contracts and budget

All routes are relative to `/api/ideas/idea-a`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Sign in and set the session cookie |
| GET | `/auth/session` | Check the active session |
| POST | `/auth/logout` | Clear the session cookie |
| GET | `/shops` | Demo shop list |
| GET | `/shops/{shop_id}` | Profile and tags |
| GET | `/listings?fruit_id=` | Seller options and availability |
| POST | `/trends/run` | Refresh or reuse the trend cache |
| GET | `/trends/latest` | Latest usable trends with sources |
| GET | `/shops/{shop_id}/feed` | Ranked recommendations |
| GET | `/shops/{shop_id}/feed/explanations` | Stream validated batched explanations |
| POST | `/orders` | Place or replay a mock order |
| GET | `/orders/{order_id}` | Saved order detail |
| GET | `/shops/{shop_id}/orders` | Shop order history |

Require a valid session for marketplace reads, writes, and streams. Idea B and the internal scheduled trend job remain available independently. Use whole quantities of 1–500 kg, eligible listings, nonempty item arrays, UUID checkout keys, and server-computed THB totals. Show clear validation and stock errors. Preserve the same checkout key across retries.

Use `OPENAI_API_KEY` server-side. Defaults are `OPENAI_MODEL=gpt-6-luna`, `OPENAI_TREND_EFFORT=low`, `OPENAI_EXPLAIN_EFFORT=none`, `IDEA_A_TREND_CACHE_HOURS=24`, and `IDEA_A_USE_SEED_TRENDS=false`. The walkthrough runs with seed mode enabled. Arrange static instructions and schemas before request-specific facts, limit web-search fan-out, cache explanation batches, and use plain Responses calls. Seeded menu tags avoid a model call on shop selection. Targets are cached feed under 300 ms, explanations under 3 s, and total PoC OpenAI spend under $5. Verify model capability and pricing before enabling live search.

## Testing Decisions

- Test Python ranking, suggestions, trend normalization and scoring, and explanation fallback with repeatable input fixtures. Use stubbed OpenAI calls in API tests, including source validation, seed mode, invalid output, and timeout.
- Use FastAPI and a migrated PostgreSQL database for checkout validation, stock races, server totals, retry idempotency, per-shop order history, and persistence after trend refresh.
- Test signed-out API access, valid and invalid credentials, cookie expiry, session resume, and sign-out. Use Playwright for sign-in, shop selection, trend refresh, mango ranked first with two sellers, product detail, edit to 5 kg, cart, checkout, order confirmation, same-key retry, and unchanged order after a new trend run. Keep cross-idea isolation coverage.
- Run `make test-idea IDEA=idea-a` and shared checks when changing migration or app wiring. Test seed-only behavior without a key. Treat latency and spend as measured demo targets.

## Out of Scope

Café stock entry, shortage/spoilage math, supplier cutoff and delivery-time rules, and copying supplier drafts. Also excluded are live scraping in the walkthrough, real payments, logistics, seller onboarding, seller UI, reviews, chat, notifications, photo grading, market-price data, routing, external messaging, third-party search tools, embeddings, Agents SDK, Assistants API, and Fast mode.

## Further Notes

Open decisions are the validated Thai domain list or prompt-only search, a Thai UI toggle, destructive cleanup of legacy restocking data, and the demo host. The local work queue under `.scratch/idea-a/` defines parallel ownership and integration order.
