# Customer build 18 — follow-up corrections

Scope: Customer Flutter only. Production and Driver build 20 remain unchanged.

The preceding customer build stopped at widget tests. Corrections:
- Sector hero height is bounded by width and available viewport height, with a maximum of 230 logical pixels; preserve space for listings, search and the fixed standalone Hatly Service card.
- Restore the visible promotion placeholder for invalid image URLs without sending a network request; keep the header decorative.
- Align product-detail tests with the approved linked circular vendor logo replacing the old summary card. Explicitly verify that the open-store add control is enabled and the closed-store add control is disabled and never calls the cart API.
- Retain existing image recommendations, vendor route links, delivery-zone queries and all established purchase rules.

Validation: the customer-app-build workflow runs Flutter analysis and the full widget suite before compiling and publishing the APK. The version remains 1.1.0+18 because the previous attempt did not publish an APK.
