# RentalSki – Planning Notes

## Confirmed scope and constraints
- **Platform:** Start with a web app (Next.js + React). Native iOS/Android can follow later.
- **Connectivity:** Staff need offline-friendly flows for weak resort networks.
- **Payments:** Support both cash-on-pickup and card; MVP focuses on cash.
- **Inventory:** Separate per shop; customers choose a specific shop. Shops may carry partial brand catalogs (e.g., only some Atomic models) and set availability per size/fit.
- **Pickup requirements:** Warn customers to bring ID/driver license; collect full name and phone when booking.
- **Locales and currency:** Romanian language and RON pricing only for now.
- **Admins:** Two roles: platform admin (you) and shop owners (limited to their shop).
- **Budget:** Prefer free/low-cost third-party services; analytics can wait.

## MVP user journeys
- **Shop discovery:** Browse/select a shop (list and map-friendly later) with filters for dates and gear categories.
- **Booking flow:** Choose dates/times, gear (ski/snowboard sets, helmet/goggles), sizes, and quantities; capture renter details (full name, phone), height/weight/shoe size for ski, shoe size/height/stance (left/right foot forward) for snowboard, and ID reminder; confirm reservation with cash-on-pickup default. Owners receive the fit data to pre-stage gear.
- **Pickup/return:** Show confirmation with QR/ID reference for pickup; staff check out gear, mark return, and handle damages/late fees.

## Admin workflows
- **Platform admin:** Create/manage shop-owner accounts; set tenant/shop configuration (name, location, contact, currencies); moderate content; view health logs.
- **Shop owner:** Manage inventory items (sizes, conditions), pricing, blackout dates/maintenance, availability caps per day/time, and reservation approvals/check-in/out. View cash/card settlement and basic reservation list exports.

## Architecture and stack (proposed)
- **Frontend:** Next.js (App Router), React, TypeScript, i18n for Romanian; component lib (e.g., Headless UI or MUI free tier). PWA/offline-ready service worker for staff pages.
- **Backend:** Next.js API routes or a small Node/Express service; PostgreSQL (or SQLite for early demos). RESTful JSON APIs; server-side auth sessions.
- **Auth:** Email/password or passwordless for users; role-based access control for platform admin vs shop owner; rate limiting.
- **Payments:** Start with cash flag in reservations; keep payments abstracted for future card provider (Stripe/Adyen when budget allows).
- **Storage/hosting:** Free-tier options (Vercel/Render/Fly.io) for web/API; Supabase/Railway free Postgres if allowed.

## Data model (early draft)
- **Tenancy:** `shops` table keyed by shop; shop-owner users linked to a single shop.
- **Catalog:** `items` (gear type, brand/model, size, condition), `item_variants` for sizes/fit, `pricing_rules`, `blackout_dates`.
- **Reservations:** `reservations` with status, pickup/return windows, quantities, cash/card flag, customer details (name, phone, ski height/weight/shoe size, snowboard height/shoe size/stance), ID reminder acknowledgment; `reservation_items` linking gear.
- **Ops logs:** `checkouts`, `returns`, `damages/fees`, audit trail per action.

## Delivery phases
1. **Design validation:** Finalize flows, wireframes, and offline needs; pick free-tier providers allowed in target regions.
2. **MVP build:** Next.js app with shop selection, catalog browsing, reservation with cash-on-pickup, and admin inventory CRUD for a single shop.
3. **Multi-shop readiness:** Platform admin tools to create shops and assign owners; isolate data per shop.
4. **Staff offline flow:** PWA/service worker cache for check-in/out screens with queued sync.
5. **Payments expansion:** Add card payments and refunds; settlement reporting.
6. **Analytics/reporting:** Add dashboards for utilization and revenue when budget allows.

## Open questions
- Do we need multi-day vs partial-day rentals with time slots?
- Should customers upload ID photos in advance or only show on pickup?
- Any delivery option (hotel delivery) besides in-store pickup?
- Return policy: late fees, extensions, and damage deposits?
- Do shops share gear across branches or strictly isolated?
