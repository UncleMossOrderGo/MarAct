<p align="center"><img src="frontend/src/shared/brand/maract-mascot.webp" alt="MarAct logo showing a grower holding a mango" width="128"></p>

# MarAct

MarAct is a fruit marketplace for shops and growers. Buyers can compare lots from different farms, calculate the delivered cost for the quantity they need, and ask a shopping assistant for help. Growers can manage their farm profile and publish listings through the web app or LINE.

**[Browse the marketplace](https://maract-market.onrender.com/market)** · [Explore fruit trends](https://maract-market.onrender.com/trends) · [Open My Farm](https://maract-market.onrender.com/farmer)

## Try it in two minutes

1. **Find a fruit lot.** Browse the mango listings. Enter the quantity you need, your delivery postcode, and your preferred arrival date to compare eligible lots by total cost, including shipping.
2. **Ask the shopping assistant.** Open the chat and ask “Can you find 20 kg of mangoes?” Follow up with “What about 40 kg?” or switch topics with “Which fruits are trending?” Expand the tool list below the reply to see what the assistant looked up.
3. **Review your cart.** When you add a suggested lot, MarAct checks the quote against the catalog again. You confirm the order at checkout.

Growers can open **My Farm** to create an account, edit their farm profile, and draft a listing. Once the grower confirms publication, buyers can find the listing in the marketplace and at `/farms`. A password account works for both buying and managing a farm. A LINE sign-in code opens the farm linked to that LINE account. [Connect a farm to LINE](backend/src/modules/farmer/README.md)

### Where the demo data comes from

Prices, stock levels, and minimum order quantities come from the PostgreSQL catalog. You can load sample lots to try the filters. Trend figures use sample data. When the assistant finds supporting news coverage, it includes citations in its reply. In the public demo, guests can search the catalog directly. Signed-in buyers can use OpenAI to interpret questions within the demo quota.

## Run locally

Install Node.js 24 with npm, Python 3.12–3.14, uv, Make, and Docker with Compose. Start Docker, then run these commands from the repository root.

```sh
make init
make dev
```

Open the [local marketplace](http://127.0.0.1:5173/market). The `make init` command creates `.env` if needed, installs dependencies, starts PostgreSQL, and loads sample data. The `make dev` command starts Vite on port 5173 and FastAPI on port 3000. Vite forwards `/api` requests to FastAPI. If you change the database port, update both `DB_PORT` and `DATABASE_URL` in `.env`.

| Task | Command |
| --- | --- |
| Check local tools and Docker connectivity | `make doctor` |
| Apply database migrations | `make migrate` |
| Load sample marketplace lots | `make seed DOMAIN=marketplace` |
| Run backend tests | `make test-api` |
| Run lint, type checks, and tests, including Playwright | `make check` |
| Build and serve the frontend and backend together | `make build` followed by `make start` |

Before your first browser test, run `npx playwright install chromium` from the `frontend` directory. The tests use PostgreSQL and require ports 5174 and 3001 to be available.

## Find your way around the code

| Feature | Frontend (React + Vite) | Backend (FastAPI) |
| --- | --- | --- |
| Marketplace, cart, and orders | [Marketplace](frontend/src/features/marketplace/) | [Pricing and quotes](backend/src/modules/marketplace/catalog.py) · [Marketplace API](backend/src/modules/marketplace/router.py) |
| Shopping assistant and fruit trends | [Copilot](frontend/src/features/copilot/) | [Intent, quotas, and tools](backend/src/modules/copilot/router.py) |
| Farm profiles, listings, and LINE | [Farmer Studio](frontend/src/features/farmer/) | [Farmer module](backend/src/modules/farmer/) |

The chat sends the buyer’s question, conversation context, and purchasing criteria to `POST /api/ideas/idea-c/copilot/chat`. The response includes the answer, its source, the tools used, and any matching lots or trends. The legacy routes `/ideas/idea-c` and `/ideas/idea-b` open the marketplace and shopping assistant respectively.

[Project structure](docs/adr/0003-product-structure.md) · [API tests](backend/tests/) · [Browser tests](frontend/tests/e2e/) · [GCP deployment guide](infra/README.md)
