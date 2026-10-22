import type { ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getShop, setShopTimezone } from "../models/shop.server";
import { getDashboard } from "../models/dashboard.server";
import { fetchShopTimezone } from "../services/shopify-shop.server";
import { sizedImageUrl } from "../utils/images";

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

// Dashboard: where orders are in the logistics flow, today's work, what needs
// attention, the last 7 days, inventory health and fast movers.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop?.locationId) return { configured: false as const };

  // Days and "today" follow the shop's time zone (read from Shopify once).
  let timeZone = shop.timezone;
  if (!timeZone) {
    timeZone = await fetchShopTimezone(admin);
    await setShopTimezone(session.shop, timeZone);
  }

  const dashboard = await getDashboard(session.shop, shop.locationId, timeZone);
  const syncedAt = shop.syncedAt?.getTime() ?? null;
  return {
    configured: true as const,
    locationName: shop.locationName,
    sync: {
      failed: shop.syncStatus === "FAILED",
      stale: syncedAt === null || Date.now() - syncedAt > SYNC_STALE_MS,
      hoursAgo:
        syncedAt === null
          ? null
          : Math.floor((Date.now() - syncedAt) / 3_600_000),
    },
    ...dashboard,
  };
};

function Tile({
  label,
  value,
  note,
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href?: string;
}) {
  const content = (
    <s-grid gap="small-300">
      <s-text color="subdued">{label}</s-text>
      <s-heading>{value}</s-heading>
      {note && <s-text color="subdued">{note}</s-text>}
    </s-grid>
  );
  return href ? (
    <s-clickable
      href={href}
      paddingBlock="small-400"
      paddingInline="small-100"
      borderRadius="base"
    >
      {content}
    </s-clickable>
  ) : (
    <s-box paddingBlock="small-400" paddingInline="small-100">
      {content}
    </s-box>
  );
}

// Divider between tiles on wide screens; tiles wrap into a grid on handhelds.
function TileDivider() {
  return (
    <s-box display="@container (inline-size <= 560px) none, auto">
      <s-divider direction="block" />
    </s-box>
  );
}

function AttentionItem({
  tone,
  title,
  description,
  href,
}: {
  tone: "warning" | "critical";
  title: string;
  description: string;
  href: string;
}) {
  return (
    <s-clickable href={href} padding="small" borderRadius="base">
      <s-grid
        gridTemplateColumns="auto 1fr auto"
        gap="small"
        alignItems="center"
      >
        <s-icon
          type={tone === "critical" ? "alert-circle" : "alert-triangle"}
          tone={tone}
        />
        <s-stack gap="small-500">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
        <s-icon type="chevron-right" tone="neutral" />
      </s-grid>
    </s-clickable>
  );
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  if (!data.configured) {
    return (
      <s-page heading="Dashboard">
        <s-section>
          <s-empty-state heading="Set up your warehouse">
            <s-paragraph slot="subheading">
              Choose the Shopify location the app manages to start tracking
              bins, picking and packing.
            </s-paragraph>
            <s-button
              slot="primary-action"
              variant="primary"
              href="/app/settings"
            >
              Go to settings
            </s-button>
          </s-empty-state>
        </s-section>
      </s-page>
    );
  }

  const { flow, today, pace, attention, inventory, trend, fastMovers, sync } =
    data;
  const consolidatedShare =
    inventory.products > 0
      ? Math.round((inventory.consolidated / inventory.products) * 100)
      : 100;
  const trendMax = Math.max(...trend.map((day) => day.orders), 1);
  const trendTotal = trend.reduce((sum, day) => sum + day.orders, 0);

  const alerts: Parameters<typeof AttentionItem>[0][] = [
    ...attention.staleRounds.map((round) => ({
      tone: "warning" as const,
      title: `Round #${round.id} open for ${round.hours}h`,
      description: `It holds ${plural(round.orders, "order", "orders")} other rounds can't pick. Finish or cancel it.`,
      href: `/app/picking/${round.id}`,
    })),
    ...(attention.withMissing > 0
      ? [
          {
            tone: "critical" as const,
            title: `${plural(attention.withMissing, "order", "orders")} with missing items`,
            description:
              "Picked incomplete, so they can't be packed. Find the units or adjust the orders.",
            href: "/app/picking?status=COMPLETED",
          },
        ]
      : []),
    ...(attention.lateFulfillments > 0
      ? [
          {
            tone: "warning" as const,
            title: `${plural(attention.lateFulfillments, "order", "orders")} packed over 24h ago`,
            description: "Still waiting for tracking to be fulfilled.",
            href: "/app/packing",
          },
        ]
      : []),
    ...(attention.mismatched > 0
      ? [
          {
            tone: "warning" as const,
            title: `${plural(attention.mismatched, "product", "products")} with stock mismatch`,
            description:
              "Shopify stock differs from bins and boxes. Recount or assign bins.",
            href: "/app/inventory?status=mismatch",
          },
        ]
      : []),
    ...(sync.failed || sync.stale
      ? [
          {
            tone: sync.failed ? ("critical" as const) : ("warning" as const),
            title: sync.failed
              ? "Inventory sync failed"
              : "Inventory sync is old",
            description:
              sync.hoursAgo === null
                ? "Shopify stock was never loaded. Sync it from Inventory."
                : `Last full sync ${sync.hoursAgo}h ago. Webhooks keep it current; sync to be sure.`,
            href: "/app/inventory",
          },
        ]
      : []),
  ];

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" variant="primary" href="/app/picking/new">
        New picking round
      </s-button>
      <s-button slot="secondary-actions" href="/app/packing">
        Pack orders
      </s-button>

      <s-query-container>
        <s-stack gap="base">
          {/* Where orders are in the flow, left to right */}
          <s-section heading="Order flow">
            <s-text slot="accessory" color="subdued">
              {data.locationName}
            </s-text>
            <s-grid
              gridTemplateColumns="@container (inline-size <= 560px) 1fr 1fr, 1fr auto 1fr auto 1fr auto 1fr"
              gap="small"
            >
              <Tile
                label="In picking"
                value={flow.ordersInPicking}
                note={plural(flow.roundsInProgress, "round", "rounds")}
                href="/app/picking?status=IN_PROGRESS"
              />
              <TileDivider />
              <Tile
                label="To pack"
                value={flow.toPack}
                note="boxes ready"
                href="/app/packing"
              />
              <TileDivider />
              <Tile
                label="To fulfill"
                value={flow.toFulfill}
                note="packed, need tracking"
                href="/app/packing"
              />
              <TileDivider />
              <Tile
                label="Packed today"
                value={flow.packedToday}
                note={`${flow.fulfilledToday} fulfilled`}
              />
            </s-grid>
          </s-section>

          {/* Actionable problems, most urgent first */}
          <s-section heading="Needs attention">
            {alerts.length > 0 && (
              <s-badge slot="accessory" tone="warning">
                {alerts.length}
              </s-badge>
            )}
            {alerts.length === 0 ? (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-icon type="check-circle" tone="success" />
                <s-text>All clear. Nothing needs attention.</s-text>
              </s-stack>
            ) : (
              <s-stack gap="small-300">
                {alerts.map((alert) => (
                  <AttentionItem key={alert.title} {...alert} />
                ))}
              </s-stack>
            )}
          </s-section>

          <s-grid
            gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
            gap="base"
          >
            {/* Today's picking, and the pace over the week */}
            <s-section heading="Today">
              <s-stack gap="base">
                <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="small">
                  <Tile label="Orders picked" value={today.orders} />
                  <Tile label="Units picked" value={today.units} />
                  <Tile
                    label="Missing"
                    value={
                      <s-stack
                        direction="inline"
                        gap="small-300"
                        alignItems="center"
                      >
                        {today.missing}
                        {today.missing > 0 && (
                          <s-icon
                            type="alert-triangle"
                            tone="critical"
                            size="small"
                          />
                        )}
                      </s-stack>
                    }
                  />
                </s-grid>
                <s-divider />
                <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                  <Tile
                    label="Avg. round time"
                    value={
                      pace.averageRoundMinutes === null
                        ? "—"
                        : `${pace.averageRoundMinutes} min`
                    }
                    note="last 7 days"
                  />
                  <Tile
                    label="Units per hour"
                    value={pace.unitsPerHour ?? "—"}
                    note={`over ${plural(pace.rounds, "round", "rounds")}`}
                  />
                </s-grid>
              </s-stack>
            </s-section>

            {/* One series: orders picked per day (bar length = orders) */}
            <s-section heading="Orders picked, last 7 days">
              <s-badge slot="accessory">{trendTotal}</s-badge>
              <s-stack gap="small">
                {trend.map((day, index) => {
                  const isToday = index === trend.length - 1;
                  return (
                    <s-grid
                      key={day.key}
                      gridTemplateColumns="64px 1fr 32px"
                      gap="small"
                      alignItems="center"
                    >
                      <s-text
                        type={isToday ? "strong" : undefined}
                        color={isToday ? undefined : "subdued"}
                      >
                        {isToday ? "Today" : day.label}
                      </s-text>
                      <s-progress
                        value={day.orders}
                        max={trendMax}
                        accessibilityLabel={`${day.label}: ${plural(day.orders, "order", "orders")} picked`}
                      />
                      <s-text type="strong">{day.orders}</s-text>
                    </s-grid>
                  );
                })}
              </s-stack>
            </s-section>
          </s-grid>

          <s-grid
            gridTemplateColumns="@container (inline-size <= 720px) 1fr, 1fr 1fr"
            gap="base"
          >
            {/* How well bins + boxes match Shopify stock */}
            <s-section heading="Inventory health">
              <s-stack gap="base">
                <s-stack gap="small-300">
                  <s-grid gridTemplateColumns="1fr auto" alignItems="end">
                    <s-text color="subdued">Consolidated products</s-text>
                    <s-heading>{`${consolidatedShare}%`}</s-heading>
                  </s-grid>
                  <s-progress
                    value={inventory.consolidated}
                    max={Math.max(inventory.products, 1)}
                    tone={consolidatedShare === 100 ? "success" : "auto"}
                    accessibilityLabel="Products whose Shopify stock matches bins and boxes"
                  />
                  <s-text color="subdued">
                    {`${inventory.consolidated} of ${plural(inventory.products, "product", "products")} match Shopify stock.`}
                  </s-text>
                </s-stack>
                <s-divider />
                <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                  <Tile
                    label="Not in a bin or box"
                    value={inventory.unaccounted}
                    note="units"
                    href="/app/inventory?status=mismatch"
                  />
                  <Tile
                    label="Over Shopify stock"
                    value={inventory.excess}
                    note="units"
                    href="/app/inventory?status=mismatch"
                  />
                  <Tile
                    label="Without a bin"
                    value={inventory.withoutBin}
                    note="products in stock"
                  />
                  <Tile
                    label="In boxes"
                    value={inventory.inBoxes}
                    note="units waiting to ship"
                  />
                </s-grid>
              </s-stack>
            </s-section>
            {/* Slotting hint: what moves most and where it lives */}
            <s-section heading="Fast movers, last 7 days" padding="none">
              <s-box paddingInline="base" paddingBlockEnd="small">
                <s-text color="subdued">
                  Keep the products picked most in bins close to packing.
                </s-text>
              </s-box>
              {fastMovers.length === 0 ? (
                <s-box padding="base">
                  <s-paragraph color="subdued">
                    No picking in the last 7 days yet.
                  </s-paragraph>
                </s-box>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header>Bin</s-table-header>
                    <s-table-header format="numeric">Orders</s-table-header>
                    <s-table-header listSlot="secondary" format="numeric">
                      Units
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {fastMovers.map((mover) => (
                      <s-table-row key={mover.inventoryItemId}>
                        <s-table-cell>
                          <s-grid
                            gridTemplateColumns="40px 1fr"
                            gap="small"
                            alignItems="center"
                          >
                            <s-box
                              inlineSize="40px"
                              blockSize="40px"
                              border="base"
                              borderRadius="base"
                              overflow="hidden"
                            >
                              {mover.imageUrl ? (
                                <s-image
                                  src={sizedImageUrl(mover.imageUrl, 80)}
                                  alt={mover.productTitle}
                                  aspectRatio="1/1"
                                  objectFit="contain"
                                />
                              ) : (
                                <s-stack
                                  alignItems="center"
                                  justifyContent="center"
                                  blockSize="100%"
                                >
                                  <s-icon type="product" tone="neutral" />
                                </s-stack>
                              )}
                            </s-box>
                            <s-stack gap="small-500">
                              <s-text>{mover.productTitle}</s-text>
                              <s-text color="subdued">
                                {mover.sku ?? "—"}
                              </s-text>
                            </s-stack>
                          </s-grid>
                        </s-table-cell>
                        <s-table-cell>{mover.bin ?? "—"}</s-table-cell>
                        <s-table-cell>{mover.orders}</s-table-cell>
                        <s-table-cell>{mover.units}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </s-grid>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
