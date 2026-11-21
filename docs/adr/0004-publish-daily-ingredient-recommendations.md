# Publish daily ingredient recommendations before page load

Compute Thai trend evidence, ingredient matching, and category fit once per Bangkok day and publish the resulting per-shop recommendations atomically. The Today page reads saved data, which keeps browsing independent of OpenAI latency and preserves the last usable snapshot during refresh failures. Save trend attribution with completed order items so daily replacement leaves purchase history intact.
