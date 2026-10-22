import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import {
  listInventory,
  type StockStatusFilter,
} from "../models/inventory.server";
import { startInventorySync } from "../services/inventory-sync.server";
import { sizedImageUrl } from "../utils/images";
import { legacyId } from "../utils/shopify-ids";

const SYNC_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 300;

const STOCK_VIEWS: { value: StockStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mismatch", label: "Mismatched" },
];

function parseCursor(value: string | null) {
  const id = Number(value);
  return value && Number.isInteger(id) ? id : undefined;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);

  if (!shop?.locationId) {
    return { configured: false as const };
  }

  const url = new URL(request.url);
  const status: StockStatusFilter =
    url.searchParams.get("status") === "mismatch" ? "mismatch" : "all";
  const query = url.searchParams.get("q")?.trim() ?? "";
  const page = await listInventory(session.shop, shop.locationId, {
    status,
    query,
    after: parseCursor(url.searchParams.get("after")),
    before: parseCursor(url.searchParams.get("before")),
  });

  return {
    configured: true as const,
    locationName: shop.locationName,
    syncStatus: shop.syncStatus,
    syncedAt: shop.syncedAt?.toISOString() ?? null,
    status,
    query,
    ...page,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop?.locationId) {
    return { ok: false, error: "Select a warehouse in Settings first." };
  }

  try {
    await startInventorySync(admin, session.shop, shop.locationId);
  } catch (error) {
    console.error(error);
    return { ok: false, error: "Inventory sync couldn't start. Try again." };
  }
  return { ok: true, error: null };
};

export default function Inventory() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const shopify = useAppBridge();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const syncing =
    fetcher.state !== "idle" ||
    (data.configured && data.syncStatus === "RUNNING");

  // Refresh while a sync is running so the table updates when it completes.
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [syncing, revalidator]);

  useEffect(() => {
    if (fetcher.data?.error)
      shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  if (!data.configured) {
    return (
      <s-page heading="Inventory">
        <s-section>
          <s-empty-state heading="Select a warehouse">
            <s-paragraph slot="subheading">
              Choose the Shopify location to manage bin stock and picking for.
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

  const { items, status, hasNextPage, hasPreviousPage } = data;

  const startSync = () => fetcher.submit({}, { method: "post" });

  // Changing the view or the search always goes back to the first page.
  const updateFilters = (changes: { status?: string; q?: string }) => {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    params.delete("before");
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== "all") params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
  };

  const onSearchInput = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => updateFilters({ q: value.trim() }),
      SEARCH_DEBOUNCE_MS,
    );
  };

  const currentView = STOCK_VIEWS.find((view) => view.value === status)!;

  const goToPage = (cursor: "after" | "before", id: number) => {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    params.delete("before");
    params.set(cursor, String(id));
    setSearchParams(params);
  };

  const neverSynced = !data.syncedAt && !syncing;

  return (
    <s-page heading="Inventory">
      <s-button
        slot="secondary-actions"
        icon="refresh"
        onClick={startSync}
        loading={fetcher.state !== "idle"}
      >
        Sync with Shopify
      </s-button>

      {syncing && (
        <s-banner tone="info" heading="Syncing inventory">
          Shopify stock for {data.locationName} is being updated. This page
          refreshes when it&apos;s done.
        </s-banner>
      )}
      {data.syncStatus === "FAILED" && !syncing && (
        <s-banner tone="critical" heading="Inventory sync failed">
          Shopify stock couldn&apos;t be loaded. Sync again to retry.
        </s-banner>
      )}

      {neverSynced ? (
        <s-section>
          <s-empty-state heading="Load your Shopify stock">
            <s-paragraph slot="subheading">
              Sync {data.locationName} to compare Shopify stock with bin stock.
            </s-paragraph>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={startSync}
            >
              Sync with Shopify
            </s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Inventory table">
          <s-table
            paginate
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => goToPage("after", items[items.length - 1].id)}
            onPreviousPage={() => goToPage("before", items[0].id)}
            loading={navigation.state === "loading"}
          >
            <s-grid
              slot="filters"
              gap="small-200"
              gridTemplateColumns="auto 1fr"
              alignItems="center"
            >
              <s-clickable
                commandFor="stock-view-menu"
                accessibilityLabel={`View: ${currentView.label}`}
                background="strong"
                borderRadius="base"
                paddingInline="small-200"
                paddingBlock="small-400"
              >
                <s-stack direction="inline" gap="small-400" alignItems="center">
                  <s-text type="strong">{currentView.label}</s-text>
                  <s-icon type="select" size="small" />
                </s-stack>
              </s-clickable>
              <s-menu id="stock-view-menu" accessibilityLabel="Stock views">
                {STOCK_VIEWS.map((view) => (
                  <s-button
                    key={view.value}
                    icon={view.value === status ? "check" : "blank"}
                    onClick={() => updateFilters({ status: view.value })}
                  >
                    {view.label}
                  </s-button>
                ))}
              </s-menu>
              <s-search-field
                label="Search products"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by product, SKU or barcode"
                value={search}
                onInput={(event) => onSearchInput(event.currentTarget.value)}
              />
            </s-grid>

            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header>Barcode</s-table-header>
              <s-table-header format="numeric">Shopify stock</s-table-header>
              <s-table-header format="numeric">Bin stock</s-table-header>
              <s-table-header format="numeric">In boxes</s-table-header>
              <s-table-header format="numeric">Bins</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((item) => {
                // Consolidated when Shopify on-hand = units in bins + units picked into boxes.
                const consolidated = item.onHand === item.accountedQuantity;
                return (
                  <s-table-row
                    key={item.id}
                    clickDelegate={`item-link-${item.id}`}
                  >
                    <s-table-cell>
                      <s-stack
                        direction="inline"
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
                          {item.imageUrl ? (
                            <s-image
                              src={sizedImageUrl(item.imageUrl, 80)}
                              alt={item.productTitle}
                              aspectRatio="1/1"
                              objectFit="cover"
                            />
                          ) : (
                            <s-stack
                              alignItems="center"
                              justifyContent="center"
                              blockSize="100%"
                            >
                              <s-icon type="image" tone="neutral" />
                            </s-stack>
                          )}
                        </s-box>
                        <s-stack>
                          <s-link
                            id={`item-link-${item.id}`}
                            href={`/app/inventory/${legacyId(item.inventoryItemId)}`}
                          >
                            {item.productTitle}
                          </s-link>
                          {item.variantTitle && (
                            <s-text color="subdued">{item.variantTitle}</s-text>
                          )}
                        </s-stack>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{item.sku ?? "—"}</s-table-cell>
                    <s-table-cell>{item.barcode ?? "—"}</s-table-cell>
                    <s-table-cell>{item.onHand}</s-table-cell>
                    <s-table-cell>{item.binQuantity}</s-table-cell>
                    <s-table-cell>{item.boxQuantity}</s-table-cell>
                    <s-table-cell>{item.binCount}</s-table-cell>
                    <s-table-cell>
                      <s-badge
                        color="base"
                        tone={consolidated ? "success" : "critical"}
                      >
                        {consolidated ? "Consolidated" : "Mismatch"}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {items.length === 0 && (
            <s-box padding="large">
              <s-empty-state
                heading={
                  data.query
                    ? "No products found"
                    : status === "mismatch"
                      ? "No stock mismatches"
                      : "No products in this warehouse"
                }
              >
                <s-paragraph slot="subheading">
                  {data.query
                    ? "Try changing the search or the view."
                    : status === "mismatch"
                      ? "Shopify stock matches bin stock for every product."
                      : `${data.locationName} has no stocked products in Shopify.`}
                </s-paragraph>
              </s-empty-state>
            </s-box>
          )}
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
