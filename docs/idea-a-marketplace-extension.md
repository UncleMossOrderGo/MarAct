# Idea A marketplace extension

The [core marketplace plan](spec.md) defines the existing daily trend and ingredient experience. This extension adds the in-app buyer, seller, and shop-assistant flows. It keeps the Bakery-first homepage and the supplied visual direction.

## OpenAI features

- **Daily trend agent** runs at 06:00 Asia/Bangkok when configured. The operator trigger, scheduler and **Run daily job** control call the same backend pipeline. It prioritizes individual public Thai food posts and uses food coverage when social evidence is sparse. Buyers can inspect the source links for each dish. The job extracts ingredients, matches shop categories, and publishes Python-ranked recommendations. A seed mode exercises the same workflow without provider calls. The homepage renders saved SQL results and keeps the previous snapshot visible while a run is in progress.
- **MarAct Assistant** opens from the buyer toolbar on desktop, the floating button on mobile, or **Ask agent** on a trend or ingredient. It calls Responses only after the buyer sends a message. Use function tools for marketplace facts and bounded context for creative replies. Web search stays in the daily job.

- **Voice dictation** sends a short recording to the server for transcription. The buyer reviews the Thai or English draft and presses Send. The app defaults to Whisper; set `OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe` to use the newer transcription model. [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)

## Morning stock review

Open **Shop stock** to count ingredients and review the last seven complete Bangkok days of usage. The seven-day top-up deducts recorded stock and quantities already in the basket, then selects available supplier offers by price. Missing counts stay visible for the owner to complete. Adding an ingredient or the full top-up opens the basket for review.

From the stock dashboard, open **Ask agent → Prepare my opening brief**. The assistant checks current inventory, trends and orders, shows its tool activity, and can propose ingredients for the owner to add. Ingredient-level questions carry the selected ingredient into the conversation.

## Social coverage and photos

The first discovery pass searches public Instagram, TikTok, YouTube, Facebook and Pantip pages through OpenAI. When it yields no usable evidence, the job can broaden to public food coverage within the same time budget. Each card links to its sources. Public post coverage depends on search availability. [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search)

For photos, the job checks dish-specific images inside supported articles, their preview metadata and available video thumbnails. For a cited Instagram or TikTok post, the buyer can open its embedded preview. A source link stays available if a publisher blocks embedding or removes the media.

## In-app buyer and seller flow

1. Start in MarAct Bakery, the only buyer store shown in the current demo. Existing shop data is retained. A dish can show a matching source preview. When one is unavailable, its card shows the story and sources. Buyer ingredient rows include only items with an orderable offer. On mobile, keep the Trend Details → Ingredients pathway and sticky action.
2. Place order creates one order per seller and reserves stock in one database transaction. The checkout response carries a group ID, each child order, and totals. A replay with the same checkout key returns the original group. Derive a unique child key per seller from the checkout key. Preserve existing order IDs and treat existing orders as single-child groups on reads. Payment and stock writes never trust frontend prices.
3. Show an explicitly labeled **Demo PromptPay** screen. Generate a non-payable demonstration QR from an internal demo payload. Display the amount and a demo countdown. **I’ve paid** moves the selected seller order from placed to paid and returns its stable receipt reference. A repeat returns the same receipt. Keep the pending order available after expiry and offer a fresh demo code. There is no transfer or gateway verification.
4. Switch to **View as seller** and select a seeded supplier. Show their incoming orders and unmatched ingredient demand. Only the assigned demo seller can confirm their paid order through the seller-scoped route. Repeated confirmation returns the current confirmed order. Invalid transitions return 409. Shop Order Details shows placed → paid → confirmed with timestamps and preserved trend labels.
5. Show an in-app notification bell with unread count. Poll every 10 seconds while visible. Publish one daily recommendation notice per shop and Bangkok date, and one notice per relevant order event. Seller gets placed and paid. Buyer gets confirmed. Use stable deduplication keys and write transactional notifications alongside the originating state change. The daily banner can be dismissed for that shop and date.
6. Add editable shop stock distinct from seller listing inventory. Validate nonnegative decimal kg and record the last update. Python calculates days of cover from stock and seven-day history. When history is zero, return no estimate.

These are demo identities selected on the webpage. Shop/seller IDs scope reads and mutations but do not authenticate a user. Keep the demo separate from a production deployment. No external notifications, logistics, money movement, or buyer–seller messaging are included.

## Assistant contract

- Store full shop-scoped threads and messages in PostgreSQL. Show three recent threads and New chat. Send at most the newest ten conversation messages per reply, with independent system instructions and tool results.
- Validate messages at 1–2,000 characters. Validate focused resource IDs against the active shop and saved data. Page context supports Today, trend, ingredients, cart, payment and order. Scope the tool adapters with the server-resolved thread shop. Scope stock, usage, profile, saved trends, listings and orders by the relevant shop or catalog rules.
- Provide read tools for shop profile, stock, usage, Today, trend detail, listings and orders. Compute concrete quantities, cover and prices in Python. Cite returned evidence. For menu, caption or recipe requests, allow creative replies in Thai or English and signal that suggestions are ideas.
- Limit function execution to four rounds and wall time to 15 seconds. Stream validated text, action proposals and a completion event over SSE. Emit a typed error on timeout or unavailable provider. Keep checkout operational and offer retry. Disconnected or failed turns must have defined retry semantics without duplicate completed replies.
- Keep proposed actions separate from execution. The first release offers Add to cart as a suggestion button and a manual stock editor. Open trend, Open order and optional Update stock suggestions remain follow-ups. Validate action shape and resolve IDs through ordinary application flows. Stock updates require visible buyer confirmation. The assistant has no tool for placing, paying or confirming an order.
- Render a safe markdown subset, and link only tool-provided source URLs. CI uses stubbed Responses, with tests for tool scoping and action non-execution.

## Endpoint and persistence changes

Keep routes relative to `/api/ideas/idea-a`. Extend the order create/read endpoints with checkout grouping. Add `POST /orders/{id}/pay`, `GET /sellers/{id}/orders`, and `POST /orders/{id}/confirm`. Add recipient-scoped notifications list/read/read-all, `GET/PUT /shops/{id}/stock`, recent/create thread endpoints under a shop, and message history/send endpoints under a thread. Sending a message streams `text`, `actions`, `done` or `error` events. Preserve existing order and catalog paths through the migration.

Append an Alembic revision. Add shop stock, checkout groups, lifecycle timestamps and references, notifications, agent threads, and agent messages. Enforce stable idempotency and recipient/event uniqueness in PostgreSQL. Keep Idea B unchanged.

## Verification

Use the fixed Pistachio Gelato order end to end. Edit a line to 5 kg, place, pay in demo mode, switch to its seller, confirm, switch back and inspect all three timeline states and the bell. Separately test a multi-seller cart, replay before and after payment, unpaid confirmation rejection, and refresh preserving all paid/confirmed orders. Test an assistant stock question with real seeded numbers and a suggested add action that updates cart only on click. Verify no provider call on page load, notification polling, or stock reads. Capture desktop with the assistant open and closed, mobile chat sheet, payment, seller, and timeline screens.

## Bangkok trial sourcing

The three highest-ranked trends share one card. A buyer can inspect the menu idea, evidence and supplier terms for each. The app remembers the trial quantity, budget and receiving date on the device. The initial scenario uses 1 kg, ฿500 and three calendar days. An expired receiving date rolls forward on the next visit.

The trial checks one ingredient. Automatic selection prioritizes fruit offers, then eligibility and delivered cost. The card calculates total price from quantity, price per kg and the supplier’s flat shipping fee. Annual holidays and time-of-day cutoffs are outside the demo. Suppliers reconfirm their seeded terms in the seller workspace. A confirmation expires after three days. The buyer screen checks again on focus and every thirty seconds. Quote submission rechecks stock and terms in the transaction. The supplier inbox receives the quote request inside MarAct.

A buyer can type or dictate Thai or English constraints under **Describe your trial**. The OpenAI Responses API returns structured fields. Python validates them and compares actual offers. The assistant uses the same comparison through its trial lot tool. Configure the interpreter with `OPENAI_TRIAL_MODEL`. The default uses GPT-6 Luna. [OpenAI model catalog](https://developers.openai.com/api/docs/models)

**Trial activity** counts trend-card visits with a qualifying lot, median time from viewing that trend to its first qualifying match, and quote requests. These are in-app demo measurements. To validate commercial demand, collect a shop owner's most recent attempted trend purchase, its original budget and deadline, the actual supplier response and the purchase outcome.
