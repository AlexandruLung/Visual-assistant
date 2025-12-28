# RentalSki Implementation Plan (MVP)

## Goals
- Deliver a web-first RentalSki app (Next.js + React + TypeScript) that supports multi-shop gear reservations with cash-on-pickup by default.
- Provide an admin experience for platform owner (super admin) and shop owners with scoped data access.
- Keep hosting and services on free/low-cost tiers where possible.

## Architecture blueprint
- **Frontend:** Next.js App Router, React, TypeScript, server actions for simple forms; Tailwind or Headless UI (free) for components; i18n with Romanian default.
- **API/backend:** Next.js API routes (or server actions) backed by PostgreSQL (Supabase/Railway free tier) with Prisma as ORM; session-based auth (NextAuth with email/passwordless, or custom if budget requires).
- **Storage:** PostgreSQL for all entities; S3-compatible object storage only if we later accept ID uploads.
- **Authz:** Role/tenant scoping enforced in middleware and API handlers (platform-admin vs shop-owner vs user).
- **Offline/staff mode:** Mark staff pages as a PWA surface with service worker caching and a small queue for check-in/out mutations when offline.

## Data model (MVP tables)
- `users`: id, email, name, role (`platform_admin` | `shop_owner` | `customer`), hashed secret (or magic-link token history), phone optional, created_at.
- `shops`: id, name, location (city, address, lat/lng), contact phone/email, description, active flag.
- `shop_owners`: user_id, shop_id (one-to-one per owner for now).
- `items`: id, shop_id, category (`ski_set` | `snowboard_set` | `helmet` | `goggles` | `poles`), brand, model, condition, base_size_label (e.g., "265-275"), stance_options (for snowboard), active flag.
- `item_sizes`: id, item_id, size_label (e.g., Mondo 27), height_min/max, weight_min/max, quantity_available, notes.
- `pricing_rules`: id, shop_id, category, daily_price_ron, deposit_required (bool), currency (`RON` only for now), min_days, max_days.
- `reservations`: id, shop_id, user_id nullable (guest), status (`pending` | `confirmed` | `checked_out` | `returned` | `cancelled`), start_date, end_date, pickup_window, return_window, payment_method (`cash` default, `card` future), customer_name, phone, ski_height_cm, ski_weight_kg, ski_shoe_mondo, snowboard_height_cm, snowboard_shoe_mondo, snowboard_stance (left/right), id_reminder_ack (bool), created_at.
- `reservation_items`: reservation_id, item_id, size_label, quantity.
- `checkouts`: id, reservation_id, staff_user_id, checkout_time, notes.
- `returns`: id, reservation_id, staff_user_id, return_time, damage_notes, fees_ron.
- `maintenance_blackouts`: id, shop_id, item_id nullable, start_date, end_date, reason.
- `audit_logs`: id, actor_user_id, shop_id, action, payload JSON, created_at.

## API surface (REST example)
- `POST /api/auth/login` (or NextAuth routes) — email/passwordless.
- `GET /api/shops` — list shops with availability flags.
- `GET /api/shops/:id/catalog` — gear categories and sizes for the shop.
- `POST /api/reservations` — create reservation with customer + fit data.
- `GET /api/reservations/:id` — detail view, scoped to user or shop owner.
- `POST /api/reservations/:id/check-out` — staff checkout (requires shop owner role or staff token).
- `POST /api/reservations/:id/return` — staff return + damage fees.
- `GET /api/admin/shops/:id/reservations` — list with filters (shop owner only).
- `POST /api/admin/shops` — platform admin creates a shop and assigns an owner.

## Frontend pages (App Router)
- `/` — shop list with basic filters (location, category availability, dates) and CTA to view a shop.
- `/shops/[shopId]` — shop detail + catalog preview; start reservation flow.
- `/reserve/[shopId]` — multi-step form: dates, gear quantities, fit inputs (ski: height/weight/shoe; snowboard: height/shoe/stance), customer name/phone, ID reminder, payment method (cash default). Confirmation page with QR/reference code.
- `/admin` — gate to admin views; redirects based on role.
- `/admin/shops/[shopId]/inventory` — list/create/edit items and sizes, set quantities, maintenance blackouts.
- `/admin/shops/[shopId]/reservations` — table with status filters, check-in/out buttons, CSV export (simple TSV download).
- `/admin/shops/[shopId]/settings` — shop profile, contact info, blackout rules, pricing defaults.
- `/staff/queue` (optional PWA scope) — offline-friendly list of today’s pickups/returns with sync status.

## Offline and cash handling
- Cache today’s reservations for a shop in IndexedDB via service worker; queue check-in/out POSTs when offline and replay on reconnect.
- For cash, store `payment_method: cash` and allow staff to mark `cash_collected` on checkout; settlement report can be a CSV export filtered by date.

## Implementation milestones
1. **Scaffold project**: Create Next.js App Router project with TypeScript, Tailwind, ESLint; set up i18n (Romanian strings), layout shell, and basic navigation.
2. **Database & auth**: Add Prisma with Postgres schema above; implement migrations; wire NextAuth (email link) or custom minimal login for shop owners; seed a demo shop and owner.
3. **Public booking flow**: Shop list/detail pages, reservation form with validation of fit fields, confirmation screen with QR/reference code; store reservations in DB with `payment_method=cash`.
4. **Admin/shop-owner UI**: Protected routes for inventory CRUD, blackout management, reservation table with check-out/return actions and CSV export.
5. **Offline staff mode (baseline)**: Service worker caching for `/staff/queue`; simple queued POSTs for check-out/return when offline; sync indicator.
6. **Polish & future**: Add card payments integration flag, analytics hooks, multi-language expansion, and mobile-ready responsive design.

## Definition of done (MVP)
- Users can browse shops, submit a reservation with required fit data, and receive a reference/QR for pickup.
- Shop owners can manage their own inventory and reservations only; platform admin can add shops and assign owners.
- Cash-on-pickup is recorded; staff can mark checkout/return and capture notes/fees.
- Data is isolated per shop; basic audit logging captures admin actions.
