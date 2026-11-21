# MarAct

MarAct helps a shop turn a food trend into a farm order. Buyers review the daily trends, compare available lots, check minimum quantities and delivery costs, and reserve stock. Growers manage their listings through Farmer Studio or a linked LINE Official Account.

## Local setup

Install Node.js 24, npm, Python 3.12–3.14, uv, Make and Docker Compose. Start Docker and run:

```sh
make init
make dev-demo
```

Open [the marketplace](http://127.0.0.1:5173/market), [shop trends](http://127.0.0.1:5173/market/shop), or [Farmer Studio](http://127.0.0.1:5173/market/farm). The seed demo uses saved trends. For live discovery and shop chat, set the server-side `OPENAI_API_KEY` in `.env` and run `make dev-live`. The live URLs use port 5175 and the API uses port 3002.

| Command | Purpose |
| --- | --- |
| `make init` | Install locked dependencies, start PostgreSQL, apply migrations, load sample data. |
| `make migrate` | Apply pending SQL and Alembic migrations. |
| `make seed DOMAIN=marketplace` | Load farm catalog fixtures. Use `DOMAIN=shop` for shop fixtures. |
| `make dev` | Start the database, API and Vite. |
| `make check` | Run the configured lint, type, API and browser checks. |
| `make build` | Build React and compile-check Python. |
| `make start` | Serve the built application from FastAPI. |

Install Chromium before the first browser test with `cd frontend && npx playwright install chromium`.

## Accounts and roles

Open [บัญชีและบทบาท](http://127.0.0.1:5173/market/login) to create an account or sign in. Choose **ผู้ซื้อ** for the buyer marketplace or **เกษตรกร** for the grower workspace. Use the account icon to switch. A newly registered grower starts with an empty farm. Sign back in to manage previously published lots and incoming orders. For a two-person demo, use separate browser profiles for the buyer and grower.

## Demo a farm order

1. **Grower.** Sign in as the grower and open Farmer Studio → **จัดการสวน** to edit a farm, or pair a LINE account. Open **ผู้ช่วยลงขาย** to describe a lot or enter its details. Set quantity, unit price, sales unit, ready date and delivery area. Review the draft and confirm publication.
2. **Buyer.** Open the buyer home at `/market`. The weekend trial starts at ฿500 for 5 kg, Bangkok postcode 10100, for the next Saturday. Adjust the inputs for the café, review the suggested fruit, farm, delivered total and remaining budget, then open the basket. Expand the comparison only if another lot is needed. A newly published lot needs a matching delivery policy.
3. **Reserve.** Add the farm lot to the marketplace basket and confirm the quote with a buyer account. The marketplace reserves stock and creates the farm order. Open the buyer's orders to see its status. The shop's sample ingredient checkout and demo PromptPay receipt are separate from this farm reservation.
4. **Farm handoff.** Open **จัดการสวน → คำสั่งซื้อจากตลาด** or send **ออเดอร์** in the linked LINE chat. Accept the reservation with payment instructions or decline it with a reason. Refresh the buyer’s order to see the decision. To show supply changing, send **สต็อก**, then **ของหมด 1** for the intended lot, and confirm. The next quote checks the new stock. The existing reservation keeps its original price. No money moves during the demo.

## Connect a LINE Official Account

Set `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` in the backend environment. Point LINE's webhook at the public HTTPS endpoint `/api/farmer/line/webhook` and enable webhook delivery. Existing integrations can keep `/api/ideas/idea-d/line/webhook`. Farmer Studio runs on localhost for the demo. Expose only the signed webhook when tunneling. Open **จัดการสวน → สร้างรหัสเชื่อม LINE**, then send the displayed pairing message to the OA within ten minutes. The grower reviews the draft in LINE before publishing.

Set `MARACT_FARM_DELIVERY` to a JSON object keyed by the grower's exact delivery-area text. For a local demonstration, the following example supplies a Bangkok policy. Replace it with agreed farm terms for a real order.

```dotenv
MARACT_FARM_DELIVERY='{"กรุงเทพฯ":{"postcodes":["10"],"transit":1,"freight":60,"window_days":7}}'
```

For a development tunnel, run the webhook-only gateway below and point the tunnel at port 3010. Use `API_PORT=3000` with the seed demo.

```sh
API_PORT=3002 uv run --locked uvicorn backend.src.modules.farmer.webhook_gateway:app --host 127.0.0.1 --port 3010
```

Private grower drafts, pairings, images and the LINE event queue use the grower adapter’s SQLite data directory. Published purchasable lots and buyer reservations use PostgreSQL. Farmer Studio currently restricts management to the local demo host. A hosted deployment also needs durable storage for grower data. The server-to-server partner API uses a separate per-farm `X-Market-Key`. [Marketplace partner contract](backend/src/modules/marketplace/README.md)

## Product structure

| Domain | Frontend | Backend |
| --- | --- | --- |
| Catalog, quotes, buyer accounts and reservations | `frontend/src/features/marketplace` | `backend/src/modules/marketplace` |
| Shopping copilot | `frontend/src/features/copilot` | `backend/src/modules/copilot` |
| Daily trends, shop stock and assistant | `frontend/src/features/shop` | `backend/src/modules/shop` |
| Farmer Studio and LINE | `frontend/src/features/farmer` | `backend/src/modules/farmer` |

Marketplace sessions and the partner API retain their established `/api/ideas/idea-c` path. The shop API is mounted at `/api/shop`. [Daily trigger setup](docs/idea-a-daily-trigger.md) · [Product structure](docs/adr/0003-product-structure.md) · [Deployment](infra/README.md)
