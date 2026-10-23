import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  assignBox,
  BoxError,
  cancelRound,
  clearBox,
  countOrdersWithoutBox,
  getRoundWithOrders,
} from "../models/picking.server";
import {
  BlockingOverlay,
  usePageActivity,
  type PendingAction,
} from "../components/BlockingOverlay";
import { PickingSteps } from "../components/PickingSteps";
import { closeScanError, ScanErrorModal } from "../components/ScanErrorModal";
import {
  useBarcodeScanner,
  useScanField,
  useWindowFocus,
} from "../hooks/useBarcodeScanner";
import { beep } from "../utils/feedback";
import {
  BOX_CODE_MAX_LENGTH,
  financialStatusLabel,
  isValidBoxCode,
  normalizeBoxCode,
} from "../utils/picking";
import { legacyId } from "../utils/shopify-ids";

const CANCEL_MODAL_ID = "cancel-round-modal";

type ActionResult =
  | { ok: true; intent: string; boxCode?: string; orderName?: string }
  | { ok: false; intent: string; error: string };

// Step 2 of the picking wizard: the reserved orders, each waiting for the
// barcode of the picking box it goes into.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const round = await getRoundWithOrders(session.shop, Number(params.roundId));
  if (!round) throw new Response("Not found", { status: 404 });
  // Boxes are fixed once picking starts: there's no going back to this step.
  if (round.plannedAt) return redirect(`/app/picking/${round.id}/pick`);

  return {
    round: {
      id: round.id,
      status: round.status,
      financialStatus: round.financialStatus,
      orderTag: round.orderTag,
      orderLimit: round.orderLimit,
    },
    orders: round.orders.map((order) => ({
      ...order,
      orderCreatedAt: order.orderCreatedAt.toISOString(),
    })),
  };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const roundId = Number(params.roundId);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const pickingOrderId = Number(formData.get("pickingOrderId"));

  if (intent === "cancel-round") {
    await cancelRound(session.shop, roundId, sessionToken?.sub ?? null);
    return redirect("/app/picking");
  }

  if (intent === "clear-box") {
    await clearBox(session.shop, roundId, pickingOrderId);
    return { ok: true, intent };
  }

  if (intent === "assign-box") {
    const boxCode = normalizeBoxCode(String(formData.get("boxCode") ?? ""));
    if (!isValidBoxCode(boxCode)) {
      return {
        ok: false,
        intent,
        error: `"${boxCode}" isn't a valid box code.`,
      };
    }
    try {
      await assignBox(session.shop, roundId, pickingOrderId, boxCode);
    } catch (error) {
      if (error instanceof BoxError) {
        return { ok: false, intent, error: error.message };
      }
      throw error;
    }
    // The last box was scanned: go straight to picking (step 3).
    if ((await countOrdersWithoutBox(roundId)) === 0) {
      return redirect(`/app/picking/${roundId}/pick`);
    }
    return {
      ok: true,
      intent,
      boxCode,
      orderName: String(formData.get("orderName") ?? ""),
    };
  }

  throw new Response("Bad request", { status: 400 });
};

// Server and browser time zones can differ, so the formatted date may change
// on hydration; that's expected.
function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function PickingRoundBoxes() {
  const { round, orders } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const focused = useWindowFocus();
  const cancelModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const boxField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const scanErrorModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const [boxCode, setBoxCode] = useState("");
  const [pending, setPending] = useState<PendingAction>({ message: "Saving…" });

  const inProgress = round.status === "IN_PROGRESS";
  const nextOrder = orders.find((order) => !order.boxCode);
  const boxedCount = orders.filter((order) => order.boxCode).length;
  const activity = usePageActivity(fetcher.state !== "idle", pending);
  // Busy until the action is saved and, if it navigates, the next page loads.
  const busy = activity.active;
  const result = fetcher.state === "idle" ? fetcher.data : undefined;

  const assign = (code: string) => {
    if (!nextOrder) return;
    // The next scan dismisses the last rejection.
    closeScanError(scanErrorModal);
    if (busy) {
      beep("error");
      shopify.toast.show("Wait for the previous scan to finish", {
        isError: true,
      });
      return;
    }
    // The last box builds the picking route (Shopify + plan): block right away.
    setPending(
      boxedCount === orders.length - 1
        ? { message: "Preparing the picking route…", immediate: true }
        : { message: "Saving the box…" },
    );
    fetcher.submit(
      {
        intent: "assign-box",
        pickingOrderId: nextOrder.id,
        orderName: nextOrder.orderName,
        boxCode: code,
      },
      { method: "post" },
    );
  };

  const scanning = inProgress && !!nextOrder;

  // The box field is the scan target: it keeps focus and Enter assigns. Scans
  // that still arrive with the focus elsewhere are caught by the global reader.
  const submitBoxField = () => {
    if (!boxCode.trim()) return;
    assign(boxCode);
    setBoxCode("");
  };

  useScanField(boxField, { enabled: scanning, onEnter: submitBoxField });
  useBarcodeScanner(assign, { enabled: scanning });

  // A rejected scan shows in a popup (closed by OK, Enter or the next scan).
  const scanError =
    result && !result.ok && result.intent === "assign-box"
      ? result.error
      : null;

  // Every scan is confirmed by sound; successes also by a toast.
  useEffect(() => {
    if (!result || result.intent !== "assign-box") return;
    beep(result.ok ? "success" : "error");
    boxField.current?.focus();
    if (result.ok) {
      shopify.toast.show(`Box ${result.boxCode} → ${result.orderName}`);
    }
  }, [result, shopify]);

  return (
    <s-page heading={`Picking round #${round.id}`} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/picking">
        Picking
      </s-link>
      {inProgress && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          commandFor={CANCEL_MODAL_ID}
          command="--show"
        >
          Cancel round
        </s-button>
      )}

      {/* Container queries below adapt the layout to handheld scanners. */}
      <s-query-container>
        <s-stack gap="base">
          <PickingSteps current={2} />

          <s-section heading="Filters">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 400px) 1fr, 1fr 1fr 1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-stack gap="small-300">
                <s-text color="subdued">Payment status</s-text>
                <s-text type="strong">
                  {financialStatusLabel(round.financialStatus)}
                </s-text>
              </s-stack>
              <s-stack gap="small-300">
                <s-text color="subdued">Order tag</s-text>
                <s-text type="strong">{round.orderTag ?? "Any"}</s-text>
              </s-stack>
              <s-stack gap="small-300">
                <s-text color="subdued">Orders</s-text>
                <s-text type="strong">
                  {orders.length} of {round.orderLimit}
                </s-text>
              </s-stack>
              {inProgress && boxedCount === 0 && (
                <s-button
                  variant="tertiary"
                  href={`/app/picking/new?round=${round.id}`}
                >
                  Edit
                </s-button>
              )}
            </s-grid>
          </s-section>

          <s-section heading="Orders & boxes">
            <s-badge
              slot="accessory"
              tone={boxedCount === orders.length ? "success" : "info"}
            >
              {`${boxedCount} of ${orders.length} boxed`}
            </s-badge>

            <s-stack gap="base">
              {inProgress && nextOrder && (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitBoxField();
                    }}
                  >
                    <s-grid
                      gridTemplateColumns="1fr auto"
                      gap="small-200"
                      alignItems="end"
                    >
                      <s-text-field
                        ref={boxField}
                        label={`Scan the box for ${nextOrder.orderName}`}
                        placeholder="Scan or type the box code"
                        details={
                          focused
                            ? "Each order goes into its own box."
                            : "Scanner paused: tap anywhere on this page so it receives scans."
                        }
                        icon="barcode"
                        autocomplete="off"
                        maxLength={BOX_CODE_MAX_LENGTH}
                        value={boxCode}
                        onInput={(event) =>
                          setBoxCode(event.currentTarget.value)
                        }
                      />
                      <s-button type="submit" loading={busy}>
                        Assign
                      </s-button>
                    </s-grid>
                  </form>
                </>
              )}

              {orders.length > 0 && boxedCount === orders.length && (
                <s-stack gap="small">
                  <s-banner tone="success" heading="Every order has a box">
                    {inProgress
                      ? "Pick the items into the boxes."
                      : "Picking is done."}
                  </s-banner>
                  {inProgress && (
                    <s-stack direction="inline" justifyContent="end">
                      <s-button
                        variant="primary"
                        href={`/app/picking/${round.id}/pick`}
                      >
                        Continue to picking
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              )}

              <s-grid
                gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))"
                gap="base"
              >
                {orders.map((order) => {
                  const isNext = inProgress && order.id === nextOrder?.id;
                  return (
                    <s-box
                      key={order.id}
                      padding="base"
                      borderRadius="large"
                      background={order.boxCode ? "subdued" : "base"}
                      border={
                        isNext
                          ? "large strong"
                          : order.boxCode
                            ? "none"
                            : "base"
                      }
                    >
                      <s-stack gap="small">
                        <s-grid
                          gridTemplateColumns="1fr auto"
                          alignItems="center"
                          gap="small"
                        >
                          <s-link
                            href={`shopify://admin/orders/${legacyId(order.orderId)}`}
                            target="_blank"
                          >
                            <s-text type="strong">{order.orderName}</s-text>
                          </s-link>
                          {order.boxCode ? (
                            <s-badge tone="success" icon="check-circle">
                              Boxed
                            </s-badge>
                          ) : isNext ? (
                            <s-badge tone="info" icon="barcode">
                              Scan box
                            </s-badge>
                          ) : (
                            <s-badge tone="neutral" icon="clock">
                              Waiting
                            </s-badge>
                          )}
                        </s-grid>
                        <s-text color="subdued">
                          <time
                            dateTime={order.orderCreatedAt}
                            suppressHydrationWarning
                          >
                            {formatDate(order.orderCreatedAt)}
                          </time>
                          {` · ${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`}
                        </s-text>
                        {order.boxCode && (
                          <s-grid
                            gridTemplateColumns="1fr auto"
                            alignItems="center"
                            gap="small"
                          >
                            <s-stack
                              direction="inline"
                              gap="small-300"
                              alignItems="center"
                            >
                              <s-icon type="package" />
                              <s-text type="strong">{order.boxCode}</s-text>
                            </s-stack>
                            {inProgress && (
                              <s-button
                                variant="tertiary"
                                icon="x"
                                accessibilityLabel={`Remove box from ${order.orderName}`}
                                onClick={() => {
                                  setPending({ message: "Removing the box…" });
                                  fetcher.submit(
                                    {
                                      intent: "clear-box",
                                      pickingOrderId: order.id,
                                    },
                                    { method: "post" },
                                  );
                                }}
                              />
                            )}
                          </s-grid>
                        )}
                      </s-stack>
                    </s-box>
                  );
                })}
              </s-grid>
            </s-stack>
          </s-section>
        </s-stack>
      </s-query-container>

      <s-modal
        ref={cancelModal}
        id={CANCEL_MODAL_ID}
        heading={`Cancel picking round #${round.id}?`}
        size="small"
      >
        <s-paragraph>
          Its {orders.length} orders are released so other picking rounds can
          take them, and their boxes are freed. This can&apos;t be undone.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          onClick={() => {
            cancelModal.current?.hideOverlay();
            setPending({ message: "Cancelling the round…", immediate: true });
            fetcher.submit({ intent: "cancel-round" }, { method: "post" });
          }}
        >
          Cancel round
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={CANCEL_MODAL_ID}
          command="--hide"
        >
          Keep round
        </s-button>
      </s-modal>

      <ScanErrorModal
        id="box-error-modal"
        heading="Box not assigned"
        error={scanError}
        trigger={result}
        modal={scanErrorModal}
      />
      <BlockingOverlay {...activity} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
