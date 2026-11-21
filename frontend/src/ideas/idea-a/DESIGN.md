# MarAct design handoff

MarAct is a mobile-first B2B fruit marketplace for cafés, smoothie shops, and bakeries. Buyers choose a shop, browse ranked fruit, compare suppliers, and place a mock order without payment or delivery processing.

## Design tokens

[market-design.css](market-design.css) defines the shared tokens. Use Inter, Lucide line icons at 20–24px, and an 8px spacing grid.

| Token | Value |
| --- | --- |
| Primary | `#237A32` |
| Selected and active background | `#EAF5E5` |
| Page and card background | `#FFFFFF` |
| Text | `#171717` |
| Secondary text | `#6B7280` |
| Border | `#E5E7EB` |
| Card radius | `12px` |
| Button radius | `10px` |

Use solid green for primary actions and a light green background for active navigation and selected offers. Use visible focus outlines. Keep surfaces flat with subtle borders.

## Screen map

| Screen | Behavior |
| --- | --- |
| Sign-in and shop selection | Resume the cookie session when available. Pick or switch a demo shop to personalize recommendations. |
| Marketplace | Show ranked fruit, price per kilogram, stock, seller, and a short reason. Search by English or Thai name. |
| Product detail | Compare offers, show the selected supplier photo, and cap whole-kg quantities at available stock and 500 kg. |
| Trends | Show cached trend evidence and linked sources. A refresh can change recommendations. |
| Cart and checkout | Keep carts separate by shop. Review quantities and estimated prices, then place an order. Keep the same checkout key for an unchanged retry. |
| Orders | Show the saved server total and order history. A trend check leaves saved orders unchanged. |
| Shop profile | Show the active shop and its menu tags. |

Use the bottom navigation on phones and the sidebar on wider screens. Keep loading, empty, error, and success feedback near the action or content it describes.

## Brand and imagery

Use the green-cap fruit seller in the wordmark, onboarding, and order success. The transparent asset lives at [brand/mascot.webp](brand/mascot.webp). Use square supplier-style photos for fruit listings. The [listing image resolver](marketplace-fruit-images.ts) selects the demo photo for the listing and falls back to the fruit photo. Keep the mascot out of product images.
