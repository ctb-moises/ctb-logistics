import type { ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getRoundSummary } from "../models/picking-run.server";
import { financialStatusLabel, pickingStatus } from "../utils/picking";
import { sizedImageUrl } from "../utils/images";
import { legacyId } from "../utils/shopify-ids";

// Read-only results of a completed picking round, by order.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const round = await getRoundSummary(session.shop, Number(params.roundId));
  if (!round) throw new Response("Not found", { status: 404 });
  if (round.status !== "COMPLETED") {
    return redirect(`/app/picking/${round.id}`);
  }

  const orders = round.orders.map((order) => {
    const lines = order.lines.map((line) => {
      // Units per bin, in route order; "No bin" for units no bin held.
      const bins = new Map<string, number>();
      let picked = 0;
      let missing = 0;
      for (const task of line.tasks) {
        picked += task.picked;
        missing += task.short;
        if (task.picked > 0) {
          const bin = task.binCode ?? "No bin";
          bins.set(bin, (bins.get(bin) ?? 0) + task.picked);
        }
      }
      return {
        id: line.id,
        productTitle: line.productTitle,
        variantTitle: line.variantTitle,
        sku: line.sku,
        imageUrl: line.imageUrl,
        quantity: line.quantity,
        picked,
        missing,
        bins: [...bins].map(([code, units]) => ({ code, units })),
      };
    });
    return {
      id: order.id,
      orderId: order.orderId,
      orderName: order.orderName,
      orderCreatedAt: order.orderCreatedAt.toISOString(),
      boxCode: order.boxCode,
      slot: order.slot,
      lines,
      units: lines.reduce((sum, line) => sum + line.quantity, 0),
      missing: lines.reduce((sum, line) => sum + line.missing, 0),
    };
  });

  return {
    round: {
      id: round.id,
      status: round.status,
      financialStatus: round.financialStatus,
      orderTag: round.orderTag,
      createdAt: round.createdAt.toISOString(),
      completedAt: round.completedAt?.toISOString() ?? null,
    },
    orders,
    totals: {
      units: orders.reduce((sum, order) => sum + order.units, 0),
      missing: orders.reduce((sum, order) => sum + order.missing, 0),
      incompleteOrders: orders.filter((order) => order.missing > 0).length,
    },
  };
};

// Server and browser time zones can differ, so the formatted date may change
// on hydration; that's expected.
function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <s-grid gap="small-300">
      <s-text color="subdued">{label}</s-text>
      {children}
    </s-grid>
  );
}

export default function PickingRoundSummary() {
  const { round, orders, totals } = useLoaderData<typeof loader>();
  const status = pickingStatus(round.status);

  return (
    <s-page heading={`Picking round #${round.id}`} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/picking">
        Picking
      </s-link>

      {/* Container queries below adapt the layout to handheld scanners. */}
      <s-query-container>
        <s-stack gap="base">
          {/* Round overview */}
          <s-section heading="Summary">
            <s-badge
              slot="supplemental"
              color="base"
              tone={status?.tone ?? "neutral"}
            >
              {status?.label ?? round.status}
            </s-badge>
            <s-stack gap="base">
              <s-grid
                gridTemplateColumns="@container (inline-size <= 480px) 1fr 1fr, 1fr 1fr 1fr"
                gap="base"
              >
                <Metric label="Orders">
                  <s-heading>{orders.length}</s-heading>
                </Metric>
                <Metric label="Units picked">
                  <s-heading>
                    {totals.units - totals.missing} of {totals.units}
                  </s-heading>
                </Metric>
                <Metric label="Missing">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-heading>{totals.missing}</s-heading>
                    {totals.missing > 0 && (
                      <s-badge tone="critical">
                        {`${totals.incompleteOrders} ${totals.incompleteOrders === 1 ? "order" : "orders"}`}
                      </s-badge>
                    )}
                  </s-stack>
                </Metric>
              </s-grid>
              <s-divider />
              <s-grid
                gridTemplateColumns="@container (inline-size <= 480px) 1fr 1fr, 1fr 1fr 1fr 1fr"
                gap="base"
              >
                <Metric label="Payment status">
                  <s-text type="strong">
                    {financialStatusLabel(round.financialStatus)}
                  </s-text>
                </Metric>
                <Metric label="Order tag">
                  <s-text type="strong">{round.orderTag ?? "Any"}</s-text>
                </Metric>
                <Metric label="Started">
                  <s-text type="strong">
                    <time dateTime={round.createdAt} suppressHydrationWarning>
                      {formatDate(round.createdAt)}
                    </time>
                  </s-text>
                </Metric>
                <Metric label="Completed">
                  <s-text type="strong">
                    {round.completedAt ? (
                      <time
                        dateTime={round.completedAt}
                        suppressHydrationWarning
                      >
                        {formatDate(round.completedAt)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </s-text>
                </Metric>
              </s-grid>
            </s-stack>
          </s-section>

          {/* One section per order, in cart slot order */}
          {orders.map((order) => (
            <s-section
              key={order.id}
              padding="none"
              accessibilityLabel={order.orderName}
            >
              <s-box padding="base">
                <s-grid
                  gridTemplateColumns="1fr auto"
                  alignItems="center"
                  gap="small"
                >
                  <s-stack gap="small-400">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-link
                        href={`shopify://admin/orders/${legacyId(order.orderId)}`}
                        target="_blank"
                      >
                        <s-text type="strong">{order.orderName}</s-text>
                      </s-link>
                      {order.slot !== null && (
                        <s-badge>{`Slot ${order.slot}`}</s-badge>
                      )}
                    </s-stack>
                    <s-stack
                      direction="inline"
                      gap="small-300"
                      alignItems="center"
                    >
                      <s-icon type="package" tone="neutral" size="small" />
                      <s-text color="subdued">{order.boxCode ?? "—"}</s-text>
                    </s-stack>
                  </s-stack>
                  {order.missing > 0 ? (
                    <s-badge tone="critical" icon="alert-triangle">
                      {`${order.missing} missing`}
                    </s-badge>
                  ) : (
                    <s-badge tone="success" icon="check-circle">
                      Complete
                    </s-badge>
                  )}
                </s-grid>
              </s-box>

              {/* s-table switches to a stacked list on narrow screens. */}
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Bins</s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">
                    Picked
                  </s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {order.lines.map((line) => (
                    <s-table-row key={line.id}>
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
                            {line.imageUrl ? (
                              <s-image
                                src={sizedImageUrl(line.imageUrl, 80)}
                                alt={line.productTitle}
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
                            <s-text>{line.productTitle}</s-text>
                            <s-text color="subdued">
                              {[line.variantTitle, line.sku]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </s-text>
                          </s-stack>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {line.bins.length > 0
                          ? line.bins
                              .map((bin) =>
                                line.bins.length > 1 ||
                                bin.units !== line.picked
                                  ? `${bin.code} ×${bin.units}`
                                  : bin.code,
                              )
                              .join(", ")
                          : "—"}
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                          justifyContent="end"
                        >
                          {line.missing > 0 && (
                            <s-badge tone="critical">{`${line.missing} missing`}</s-badge>
                          )}
                          <s-text type="strong">{`${line.picked}/${line.quantity}`}</s-text>
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          ))}
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
