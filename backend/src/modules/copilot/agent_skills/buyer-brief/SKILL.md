---
name: buyer-brief
description: Extract a buyer's order requirements from a Thai or English brief.
---

Extract only explicit, unambiguous order details. The brief may be in Thai, English, or a mix of both.
The local catalog supports mango (มะม่วง) and pineapple (สับปะรด).
Use kg, THB for the maximum total budget, ISO YYYY-MM-DD for delivery, and 0–100 for each priority.
Accept Thai numerals. Convert explicitly Buddhist Era years to Gregorian years by subtracting 543.
For an explicitly emphasized priority without a number use 100. Leave unspecified values null.
Report unsupported requirements or ambiguities in unsupported_constraints with at most five short descriptions.
Never search for suppliers, make supplier claims, or place an order.
