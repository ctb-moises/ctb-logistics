# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

# Project conventions

Add new conventions here as they are agreed.

## Language

- Everything in the repo is in English: code, comments, UI text, toasts, errors, Prisma schema.
- Domain terms: Shopify **location** = warehouse; **bin** = physical storage spot inside a location (aisle/rack/shelf).

## Inventory domain

- Inventory and picking operate on **variants only** — the unit is the Shopify inventory item (one per variant). Never aggregate or pick at product level.
- All bin stock changes go through `app/models/bin-stock.server.ts`, which writes `BinStock`, its `StockMovement` and `InventoryLevel.binQuantity` in one transaction. Never update `BinStock` directly elsewhere.
- Bin codes are trimmed and uppercased (`normalizeBinCode` in `app/utils/bins.ts`); unique per shop + location.
- Excluded everywhere (`isManagedItem` in `app/services/inventory-sync.server.ts`):
  - SKUs starting with `config_` — the catalog was imported from Magento with configurable (parent) products as standalone single-variant products; they never take part in logistics, whatever their Shopify stock.
  - Inventory items with "Track quantity" off (`inventoryItem.tracked = false`).

## Picking domain

- A picking round (`PickingRound`) is a batch of orders picked together. The Picking menu opens the rounds list (`/app/picking`, with a "New picking round" primary action). Rounds are built with a wizard: 1 Filters (`/app/picking/new`) → 2 Orders & boxes (`/app/picking/:id`) → 3 Pick.
- Round statuses: `IN_PROGRESS` ("In progress", tone info; set when step 1 creates the round, so the wizard survives refreshes and can be resumed) and `COMPLETED` ("Completed", tone success). Labels/tones live in `PICKING_STATUSES` (`app/utils/picking.ts`). Filters are editable only while `IN_PROGRESS`.
- Filters: Shopify financial status (default `paid`), optional order tag, and order count. Only unfulfilled orders of the selected location are picked.
- "Orders per round" options come from Settings (`Shop.pickingBatchSizes`, comma-separated, first = default; parsed by `parseBatchSizes`).
- Step 1 "Next" reserves the orders (oldest first, unfulfilled, with an open fulfillment order at the location, not reserved by another round) — `reserveRoundOrders` in `app/services/picking.server.ts`. A round is only created if at least one order is reserved.
- Concurrency is enforced by unique keys on `PickingOrder` that are set only while held: `reservationKey` (`<shop>|<orderId>`) and `boxKey` (`<shop>|<boxCode>`). Never check-then-write without them; a unique violation means another round won (retry or report).
- Cancelling a round deletes it: its orders and boxes are released. Filters can only change before any box is assigned.
- Each order gets its own picking box (scanned barcode). A box stays in use until Shopify reports the order fulfilled or cancelled (`orders/fulfilled`, `orders/cancelled` webhooks → `releaseOrder`).
- Box codes are trimmed and uppercased (`normalizeBoxCode`).
- Wizard pages use `inlineSize="small"`, show `PickingSteps` at the top and end with Cancel/Back + primary Next aligned right.

## Admin UI/UX

The app must look and behave like native Shopify admin. Follow the official App Home patterns and templates exactly (https://shopify.dev/docs/api/app-home) — check the matching template before building a page.

- Use Polaris web components (`s-*`) only. No custom CSS, no third-party UI kits, no raw HTML layout where a component exists.
- Pages: one `s-page` per route with `heading`; settings/forms use `inlineSize="small"`. Page-level actions go in the `primary-action` / `secondary-actions` slots, not inside sections.
- Sections: group related fields in `s-section` with `heading`; put explanatory text in `subheading`, not in a paragraph.
- Saving forms: wrap the form in `<form data-save-bar>` (contextual save bar). No in-page Save buttons on edit/settings forms. Confirm success with `shopify.toast.show(...)`; show validation errors on the field (`error` prop).
- Destructive actions: `tone="critical"` and confirm with the Modal API.
- Lists/tables: use the Index/Resource list patterns (`s-table` with pagination, filters, empty state). Always provide an empty state.
- Navigation lives in `s-app-nav` in `app/routes/app.tsx`.
- Copy: sentence case, short, Shopify admin tone (e.g. "Settings saved", "Select a location").

## Performance and data access

- **No N+1 queries.** Never call Prisma or the Admin API inside a loop over rows. Fetch related data in one query (`include`/`select`, `where: { id: { in: ids } }`) and join in memory with a `Map`.
- Shopify Admin API: batch by ids with `nodes(ids: [...])`, paginate with cursors (`first` ≤ 250), and request only the fields the page renders. Prefer bulk operations for full-catalog syncs.
- Run independent loader work in parallel (`Promise.all`).
- Paginate every list on the server; never load a whole table into a page.
- Bulk writes: `createMany`/`updateMany`, or a single `$transaction` — not one round-trip per row. Stock changes and their `StockMovement` rows go in the same transaction.
- Every query is scoped by `shop`; indexes must start with the columns used in the `where` (usually `shop`, then the lookup key). Add an index with any new query pattern.
- Use `select` to avoid loading unused columns on large tables (`BinStock`, `StockMovement`).
- Data that list pages filter or sort on across the whole catalog (e.g. Shopify stock vs bin stock) is mirrored locally (`InventoryLevel`) and kept fresh by bulk operations + webhooks — never scan the Admin API per request.
- Denormalized totals (`InventoryLevel.binQuantity`) must be updated in the same transaction as the rows they summarize (`BinStock`).

## Server/client boundary

- Route components must not import anything from `*.server.ts` modules (only `loader`/`action` may); React Router fails the route at runtime and `tsc` doesn't catch it. Put values shared by UI and server (constants, pure helpers) in `app/utils/`.
- After changing a route, request it from the running dev server (or start a temporary one: `npx react-router dev --port <free port>` and stop it afterwards) (`curl http://localhost:<vite port>/app/routes/<file>`) to catch these errors.

## Database migrations

- `prisma migrate dev` refuses to run non-interactively when a change needs confirmation. Then generate the SQL with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url file:<empty temp file outside the repo> --script` into a new `prisma/migrations/<timestamp>_<name>/migration.sql`, check it isn't empty (Prisma writes `-- This is an empty migration.` when the schema didn't change), and apply with `prisma migrate deploy`.
- Data changes that come with a schema change (e.g. renaming a status value) go in the same migration as plain SQL.

## Shopify Admin API

- Write queries as `#graphql`-tagged template literals without `${}` interpolation, then run `npm run graphql-codegen`: it validates them against the Admin schema and generates the types in `app/types`.
- Writing Shopify inventory (`app/services/shopify-inventory.server.ts`, needs `write_inventory`):
  - Inventory mutations require `@idempotent(key: ...)` (API ≥ 2026-04). Generate the key when the user opens the action (client, `crypto.randomUUID()`), send it with the form, store it on the `StockMovement.idempotencyKey` (unique) and skip if already applied — so retries/double submits apply once in Shopify and locally.
  - `changeFromQuantity` must be passed explicitly (`null` only for purely additive changes such as receiving).
  - Call Shopify first, then record locally. Set `InventoryLevel.onHand` to the absolute `quantityAfterChange` from the response (request it with `changes(quantityNames: ["on_hand"])` — by default only the adjusted quantity is returned), never increment it (the `inventory_levels/update` webhook may already have updated it).
  - Use `referenceDocumentUri: gid://ctb-logistics/<Entity>/<id>` so the change is traceable in Shopify's inventory history.
- Webhook handlers must answer within 5s: do slow work (e.g. processing a bulk operation result) after acknowledging.

## Images and status

- Store original Shopify image URLs; size them where they're shown with `sizedImageUrl` (`app/utils/images.ts`), e.g. 80px in tables, 320px on detail pages (rendered at half size for sharp screens).
- Stock status wording: **Consolidated** (Shopify stock = bin stock, `tone="success"`) / **Mismatch** (`tone="critical"`).

## Barcode scanning

- Use `useBarcodeScanner` (`app/hooks/useBarcodeScanner.ts`): it buffers keyboard-wedge scanner input and emits the code on Enter, ignoring keys typed into fields and slow (manual) typing.
- The embedded app only gets key presses while its iframe has focus: show a "Scanner paused" banner using `useWindowFocus`.
- Every scan gets audible feedback (`beep` in `app/utils/feedback.ts`) plus a toast on success or a persistent banner on error. Always offer a manual entry field as fallback.

## Index pages

- Table header (`slot="filters"`) mirrors Shopify's Products list: a view selector on the left (`s-clickable` + `s-menu`, checkmark on the active view), then a search field filling the rest.
- Search filters as you type with a 300 ms debounce; filters and search live in the URL (`replace: true`) and reset pagination to the first page.
- Pagination is cursor-based (`after`/`before` ids) through `s-table`'s `paginate` props.

## Detail pages

- Route `app.<resource>.$id.tsx`; when the list has the same prefix, the list route is `app.<resource>._index.tsx` so the detail page isn't nested in it.
- Use URL ids that survive resyncs (Shopify numeric ids, e.g. inventory item), not local autoincrement ids.
- Back navigation in the `breadcrumb-actions` slot. Section status in `supplemental`, counts in `accessory`.
- Put the page's main action in the page's `primary-action` slot. A section's `primary-action` slot didn't render in practice (polaris-types 1.1.0), so don't rely on it; empty states should repeat the action.
- Edits happen in an `s-modal` opened with `commandFor` + `command="--show"`; submit through a fetcher, keep the modal open on validation errors (shown on the field), close it with `hideOverlay()` and show a toast on success.
- Index rows open the detail page via `clickDelegate` pointing at the link in the primary cell.
