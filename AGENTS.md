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
- A `BinStock` row exists only while its quantity is positive: reaching 0 deletes it (`dropEmptyBinStock`; the bin stays), and units coming back (undo, cancelled round) recreate it (`returnToBin`). Movements keep the history.
- Bin codes are trimmed and uppercased (`normalizeBinCode` in `app/utils/bins.ts`); unique per shop + location.
- Excluded everywhere (`isManagedItem` in `app/services/inventory-sync.server.ts`):
  - SKUs starting with `config_` — the catalog was imported from Magento with configurable (parent) products as standalone single-variant products; they never take part in logistics, whatever their Shopify stock.
  - Inventory items with "Track quantity" off (`inventoryItem.tracked = false`).

## Picking domain

- A picking round (`PickingRound`) is a batch of orders picked together. The Picking menu opens the rounds list (`/app/picking`, with a "New picking round" primary action). Rounds are built with a wizard: 1 Filters (`/app/picking/new`) → 2 Orders & boxes (`/app/picking/:id`) → 3 Pick.
- In the rounds list, in-progress rows open `/app/picking/:id`, which resumes at the current step (step 2, or redirect to step 3); completed rows open the read-only summary `/app/picking/:id/summary` (results by order, in slot order). Step 3 redirects to a success page (`/app/picking/:id/done`, totals + "Back to picking rounds") once the round completes; the summary is only opened from the list. When a round completes, its fully picked orders get the Shopify tag `picked` (`PICKED_ORDER_TAG`; orders with missing units don't). `tagsAdd` takes one order, so `addOrderTags` batches up to 25 aliased mutations per request; `PickingOrder.taggedAt` records success and the success page retries the rest.
- Round statuses: `IN_PROGRESS` ("In progress", tone info; set when step 1 creates the round, so the wizard survives refreshes and can be resumed) and `COMPLETED` ("Completed", tone success). Labels/tones live in `PICKING_STATUSES` (`app/utils/picking.ts`). Filters are editable only while `IN_PROGRESS`.
- Filters: Shopify financial status (default `paid`), optional order tag, and order count. Only unfulfilled orders of the selected location are picked.
- "Orders per round" options come from Settings (`Shop.pickingBatchSizes`, comma-separated, first = default; parsed by `parseBatchSizes`).
- Step 1 "Next" reserves the orders (oldest first, unfulfilled, with an open fulfillment order at the location, not reserved by another round) — `reserveRoundOrders` in `app/services/picking.server.ts`. A round is only created if at least one order is reserved.
- Concurrency is enforced by unique keys on `PickingOrder` that are set only while held: `reservationKey` (`<shop>|<orderId>`) and `boxKey` (`<shop>|<boxCode>`). Never check-then-write without them; a unique violation means another round won (retry or report).
- Cancelling a round deletes it: its orders and boxes are released. Filters can only change before any box is assigned.
- Each order gets its own picking box (scanned barcode). The box and the reservation stay held until Shopify reports the order fulfilled or cancelled (`orders/fulfilled`, `orders/cancelled` webhooks → `releaseOrder`).
- Box codes are trimmed and uppercased (`normalizeBoxCode`).
- Scanning the last box redirects to step 3 (`/app/picking/:id/pick`, route file `app.picking.$roundId_.pick.tsx` — the `_` keeps it out of step 2's layout). Boxes can't change once picking starts (`PickingRound.plannedAt`), so there's no way back: step 3 has no link to step 2, and step 2 redirects to step 3 once planned.
- Picking plan (`ensurePickingPlan` → `savePickingPlan`, built once): cart slots follow box scan order; lines come from the orders' open fulfillment orders at the location (`PickingLine`); `buildPickingPlan` (`app/utils/picking-plan.ts`, pure) lays out the route. A step = one product in one bin; steps follow bins alphabetically (natural order, "no bin" last); a product's units come from its bins in route order, the remainder spilling to its next bin; orders are served in slot order. Each `PickingTask` is one card (order/box) of a step.
- Picking a unit (scan or +) takes it from the bin right away: `BinStock` −1, `StockMovement` `PICK` (reference `picking-round:<id>`), `InventoryLevel.binQuantity` −1, in one transaction. `stockTaken` records units really taken, so undo (−) and cancelling a round return exactly those. Each picked unit moves from `binQuantity` to `boxQuantity`; on fulfillment (webhook) it leaves `boxQuantity` while Shopify's on-hand drops, so the product stays Consolidated throughout.
- A scan must match the step product's barcode (variant barcode); otherwise show an error, naming the product and step if the barcode belongs to another product of the round. "Mark as missing" records the rest of the step as `short`.
- When every task is picked or short the round becomes `COMPLETED`. Reservations and boxes stay held until Shopify reports the order fulfilled or cancelled — a completed round's orders are still unfulfilled and must not be picked again. A completed step auto-advances to the next open step after 1 s.
- Wizard pages use `inlineSize="small"`, show `PickingSteps` at the top and end with Cancel/Back + primary Next aligned right.

## Packing & Fulfillment domain

- Packing (`/app/packing`) starts by scanning a box; it opens the order in it (`/app/packing/:pickingOrderId`) only if its round is completed, every unit was picked (no `short`), and it isn't packed (or, in pack-and-fulfill mode, fulfilled) yet. `findBoxForPacking` explains every refusal.
- Each product scan (or the line's + button, for manual validation or products without a barcode; − undoes) checks one unit into the parcel (`PickingLine.packed`, conditional update against over-packing). Expected per line = units picked. Wrong barcode → error. When every line is complete the order is `packedAt`, gets the Shopify tag `packed` (`PACKED_ORDER_TAG`, retried on page load via `packedTaggedAt`).
- `Shop.packingMode`: `PACK` (tag only) or `PACK_AND_FULFILL` (Settings → Packing & Fulfillment). The mode is recorded on the order when it's packed (`PickingOrder.fulfillAfterPacking`); changing the setting later never reopens packed orders. `isPackingDone` is the single rule for "packing finished". In pack-and-fulfill the tracking modal opens when packing completes: carrier (Shopify carrier names in `CARRIERS`, or Other with name + tracking URL), tracking number, notify customer.
- Fulfillment (`fulfillPackedOrder`): `fulfillingAt` lock against double submits; checks the order's fulfillment orders at the location (not closed/cancelled, no holds, `CREATE_FULFILLMENT` supported) and fulfills them all with `fulfillmentCreate` (needs `write_merchant_managed_fulfillment_orders`); then frees the box right away with `releaseOrder` (the `orders/fulfilled` webhook only fires when the whole order is fulfilled).
- Like picking, packing ends on a success page (`/app/packing/:id/done`: outcome, tag status, "Pack next box" back to the box scan). Pack only: right after the last scan. Pack and fulfill: after the fulfillment; "Later" in the tracking modal leaves the order packed on its page with "Fulfill order" / "Back to packing".

## Dashboard

- `/app` (app home, opened by the app name in the admin) is the logistics dashboard: order flow (in picking → to pack → to fulfill → packed today), needs attention (stale rounds >2h, orders with missing items, packed >24h without fulfillment, stock mismatches, old/failed inventory sync), today + pace (avg round time, units/hour over 7 days), orders picked per day (7 days, one series, bars via `s-progress` with values beside them), inventory health, fast movers with their main bin.
- Data comes only from the app's tables in a fixed number of aggregated queries (`getDashboard`, `app/models/dashboard.server.ts`), run in parallel — no Shopify calls besides reading the shop time zone once (`Shop.timezone`).
- "Today" and day buckets use the shop's time zone (`app/utils/time-zone.ts`), never the server's.

## Admin UI/UX

The app must look and behave like native Shopify admin. Follow the official App Home patterns and templates exactly (https://shopify.dev/docs/api/app-home) — check the matching template before building a page.

- Use Polaris web components (`s-*`) only. No custom CSS, no third-party UI kits, no raw HTML layout where a component exists.
  - End-of-flow pages (picking/packing done) use `SuccessState` (`app/components/SuccessState.tsx`): a 72px illustration in `s-image` (Polaris icons don't render large), outcome, details block, one full-width action.
  - Exceptions: `BlockingOverlay` (see "Loading and blocking") and `DisplayText` (`app/components/DisplayText.tsx`) for values operators must read at a distance on scan screens (bin code, cart slot). Polaris has no display-size text. Don't add other custom styling.
- Responsive props written as `@container (...)` only work inside an `s-query-container`: wrap the page content (`<s-query-container><s-stack gap="base">…`) whenever a page uses them.
- Picking screens are used on handheld scanners (PDAs, ~360–480px wide): design them mobile-first. Use container queries at `inline-size <= 480px`, and `display="@container (...) none, auto"` to move small pieces (e.g. +/− controls) between layouts. Put what guides the operator first and largest (the bin, then the slot).
- Pages: one `s-page` per route with `heading`; settings/forms use `inlineSize="small"`. Page-level actions go in the `primary-action` / `secondary-actions` slots, not inside sections.
- Sections: group related fields in `s-section` with `heading`; put explanatory text in `subheading`, not in a paragraph.
- Saving forms: wrap the form in `<form data-save-bar>` (contextual save bar). No in-page Save buttons on edit/settings forms. Confirm success with `shopify.toast.show(...)`; show validation errors on the field (`error` prop).
- Destructive actions: `tone="critical"` and confirm with the Modal API.
- Lists/tables: use the Index/Resource list patterns (`s-table` with pagination, filters, empty state). Always provide an empty state.
- Navigation lives in `s-app-nav` in `app/routes/app.tsx`. The `/app` link must keep `rel="home"`: the app name in the admin sidebar opens the home route, which otherwise defaults to `/` (no session → login form). That link is hidden from the menu; the app name is the way to the dashboard.
- Copy: sentence case, short, Shopify admin tone (e.g. "Settings saved", "Select a location").

## Performance and data access

- **No N+1 queries.** Never call Prisma or the Admin API inside a loop over rows. Fetch related data in one query (`include`/`select`, `where: { id: { in: ids } }`) and join in memory with a `Map`.
- Shopify Admin API: batch by ids with `nodes(ids: [...])`, paginate with cursors (`first` ≤ 250), and request only the fields the page renders. Prefer bulk operations for full-catalog syncs.
- Run independent loader work in parallel (`Promise.all`).
- Paginate every list on the server; never load a whole table into a page.
- Bulk writes: `createMany`/`updateMany`, or a single `$transaction` — not one round-trip per row. Stock changes and their `StockMovement` rows go in the same transaction.
- Every query is scoped by `shop`; indexes must start with the columns used in the `where` (usually `shop`, then the lookup key). Add an index with any new query pattern.
- Use `select` to avoid loading unused columns on large tables (`BinStock`, `StockMovement`).
- `inventory_levels/update` only fires when *available* changes. Fulfillments (and their cancellation) change on-hand without touching available, so on-hand is re-read on `fulfillments/create` / `fulfillments/update` (these topics need the `read_fulfillments` scope) and right after the app's own fulfillments (`refreshFulfillmentStock`).
- Data that list pages filter or sort on across the whole catalog (e.g. Shopify stock vs bin stock) is mirrored locally (`InventoryLevel`) and kept fresh by bulk operations + webhooks — never scan the Admin API per request.
- Denormalized totals on `InventoryLevel` — `binQuantity` (bins), `boxQuantity` (units picked into boxes whose orders aren't fulfilled/cancelled yet) and `accountedQuantity` (= bin + box) — change only through `adjustLevelTotals` / `recomputeLevelTotals` (`app/models/inventory.server.ts`), in the same transaction as the rows they summarize. Editing `BinStock` / picking tables directly in the database (e.g. Prisma Studio) leaves them stale; a full "Sync with Shopify" recomputes them from source.

## Server/client boundary

- Route components must not import anything from `*.server.ts` modules (only `loader`/`action` may); React Router fails the route at runtime and `tsc` doesn't catch it. Put values shared by UI and server (constants, pure helpers) in `app/utils/`.
- To look at a page without the admin, render it statically (react-router `createStaticHandler` + `renderToString` with sample loader data, dummy `SHOPIFY_*` env vars), wrap it with `<script src="https://cdn.shopify.com/shopifycloud/polaris.js">`, and screenshot it with headless Chrome at desktop and 400px widths.
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
- Stock status wording: **Consolidated** (Shopify on-hand = units in bins + units in boxes waiting to ship, i.e. `onHand === accountedQuantity`, `tone="success"`) / **Mismatch** (`tone="critical"`). Units picked but not yet fulfilled are still on hand for Shopify, so they count.

## Loading and blocking

- Actions that save data block the page with `BlockingOverlay` (`app/components/BlockingOverlay.tsx`): a fixed layer with a Polaris spinner and what's happening. Don't call `shopify.loading()` with it: the admin then shows its own unlabelled spinner on top. It stays up through the redirect until the next page is ready. Polaris has no blocking overlay; this layer is the only custom positioning besides `DisplayText`.
- Use `usePageActivity(fetcherBusy, pending)` with a `pending` action set when submitting: long transitions (they call Shopify or change step: last box, last pick, reserving orders, fulfilling, receiving stock, cancelling) use `immediate: true`; single scans only show it after 250 ms, so it doesn't flash. Messages for redirects come from the target path (`NAVIGATION_MESSAGES`).
- While busy, ignore new scans with an error beep. Close a modal before a long action so the overlay is visible, and reopen it on error.
- List pages don't block on navigation (search/filter typing); only on their own long actions.

## Barcode scanning

- Use `useBarcodeScanner` (`app/hooks/useBarcodeScanner.ts`): it buffers keyboard-wedge scanner input and emits the code on Enter, ignoring keys typed into fields and slow (manual) typing.
- The embedded app only gets key presses while its iframe has focus: show a "Scanner paused" banner using `useWindowFocus`.
- Scan steps have a visible scan field ("Scan or type …") wired with `useScanField`: Enter in the field submits (Polaris fields don't submit forms on Enter) and the field keeps focus (on load, after each scan, when the app regains focus, after clicks on non-interactive areas), so the scanner types into it. `useBarcodeScanner` stays on as a fallback for scans that arrive with focus elsewhere.
- Product barcodes are GTINs: compare them with `sameBarcode` / look them up with `barcodeVariants` (`app/utils/barcodes.ts`), never with `===`. The same product can be stored as EAN-13 (`0022600200031`) and scan as UPC-A (`022600200031`).
- Modals that take a scanned value (e.g. tracking number) focus that field `onAfterShow` and, while open (`onShow`/`onHide`), route scans received without focus to it. A scan never submits a modal by itself.
- Scan screens keep their space for the work (bin, slot, products, boxes): no inline banners for scan feedback.
  - Rejected scans open `ScanErrorModal` (`app/components/ScanErrorModal.tsx`), closed by OK, Enter or the next scan (`closeScanError` before processing a scan).
  - Instructions and "Scanner paused" go in the scan field's `label` / `details`; transient successes are toasts (plus `beep`).
  - Inline banners only for the page's main state when there's nothing else to do (e.g. an order that can't be packed).
- Every scan gets audible feedback (`beep` in `app/utils/feedback.ts`). Always offer a manual entry field as fallback.

## Index pages

- Table header (`slot="filters"`) mirrors Shopify's Products list: a view selector on the left (`s-clickable` + `s-menu`, checkmark on the active view), then a search field filling the rest.
- Search filters as you type with a 300 ms debounce; filters and search live in the URL (`replace: true`) and reset pagination to the first page.
- Pagination is cursor-based (`after`/`before` ids) through `s-table`'s `paginate` props.

## Detail pages

- Route `app.<resource>.$id.tsx`; when the list has the same prefix, the list route is `app.<resource>._index.tsx` so the detail page isn't nested in it.
- Use URL ids that survive resyncs (Shopify numeric ids, e.g. inventory item), not local autoincrement ids.
- Back navigation in the `breadcrumb-actions` slot. Section status in `supplemental`, counts in `accessory`.
- Put the page's main action in the page's `primary-action` slot. Action slots of `s-section` (`primary-action`) and `s-banner` (`secondary-actions`) didn't render in practice (polaris-types 1.1.0): never put buttons there — place them in the content (e.g. a right-aligned inline stack). Empty states should repeat the action.
- Edits happen in an `s-modal` opened with `commandFor` + `command="--show"`; submit through a fetcher, keep the modal open on validation errors (shown on the field), close it with `hideOverlay()` and show a toast on success.
- Index rows open the detail page via `clickDelegate` pointing at the link in the primary cell.
