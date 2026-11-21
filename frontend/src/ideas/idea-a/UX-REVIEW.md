# Daily marketplace visual review

Reviewed the integrated `/ideas/idea-a` route against the supplied “MarAct B2B Ingredient Marketplace UX/UI Overview” board. The review uses fixed Bangkok dates and intercepted reads, job status, and checkout responses. The screenshots exercise the real page components and routing. The seeded database walkthrough remains in the integration suite.

From `frontend/`, run:

```sh
MARACT_UX_REVIEW=1 npm run test:web -- --config playwright.components.config.ts market-ux-review.spec.ts --output test-results/ux-review
```

Each capture is attached to its Playwright test in [the review output](../../../test-results/ux-review/). Use the named PNGs below for comparison.

| Reference panel | Result | Capture and difference |
| --- | --- | --- |
| Desktop Today at 1440 px | Needs visual follow-up | `desktop-today-en.png`, `desktop-today-th.png`. Sidebar, Bakery, run action, featured photo, badges, menu idea, and sources match the hierarchy. Today previews prices and quantities. Quantity controls and Add All live on Ingredients, one step away from the board’s inline controls. Owner is Today and integration. |
| Desktop Marketplace at 1440 px | Pass | `desktop-marketplace.png`. The three-listing review fixture uses three cells of the four-column catalog grid. Search, category controls, stock, prices, and add actions are visible. |
| Desktop Orders at 1440 px | Pass | `desktop-orders.png`. The card carries the saved trend label, date, total, and status. The implementation opens a separate detail view and omits status filters and decorative preview photos from the board. |
| Mobile Today and detail at 390 px | Pass | `mobile-today-th.png`, `mobile-trend-detail.png`. The featured photo, source link, badges, and detail tabs remain readable. Compact navigation labels reserve space above the phone safe area. |
| Mobile Ingredients and Cart at 390 px | Pass | `mobile-ingredients.png`, `mobile-cart.png`. Unmatched kataifi stays visible outside the purchasable lines. Increasing pistachio to 5 kg shows ฿5,495.00 and the cart action remains in the viewport. |
| Mobile Checkout and Order Placed at 390 px | Pass | `mobile-checkout.png`, `mobile-checkout-error.png`, `mobile-order-placed.png`. Retry retains the cart. The success actions sit before the receipt; the saved trend and total remain in the receipt. |
| Settings and additional states | Pass | `desktop-settings.png`, `desktop-refresh.png`, `mobile-skeleton.png`, `mobile-reload-skeleton.png`, `mobile-today-error.png`, `mobile-today-empty.png`. Thai/English switching, stable refresh, retry, empty, and load states are visible. |
| 360 px overflow | Pass | `mobile-today-th-360.png` and `mobile-order-placed-360.png` fit without horizontal overflow. |

The browser checks passed. Keep these captures in Playwright output for review. Promote the approved captures to regression baselines after resolving or accepting the desktop Today difference.
