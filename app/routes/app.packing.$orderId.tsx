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
import { getShop } from "../models/shop.server";
import {
  getPackingOrder,
  isPackingDone,
  PackingError,
  packUnit,
  unpackUnit,
} from "../models/packing.server";
import { fulfillPackedOrder, tagPackedOrder } from "../services/packing.server";
import {
  useBarcodeScanner,
  useScanField,
  useWindowFocus,
} from "../hooks/useBarcodeScanner";
import {
  BlockingOverlay,
  usePageActivity,
  type PendingAction,
} from "../components/BlockingOverlay";
import { beep, scanErrorToast } from "../utils/feedback";
import { sizedImageUrl } from "../utils/images";
import { CARRIERS, OTHER_CARRIER, TRACKING_MAX_LENGTH } from "../utils/packing";
import { legacyId } from "../utils/shopify-ids";

const FULFILL_MODAL_ID = "fulfill-modal";

type ActionResult =
  | { ok: true; intent: string; complete?: boolean }
  | { ok: false; intent: string; error: string };

// Packing one order: scan each product into the parcel; when every picked unit
// is in, the order is tagged "packed" and, in pack-and-fulfill mode, fulfilled
// with the carrier and tracking number. Then the success page takes over.
const donePath = (id: number) => `/app/packing/${id}/done`;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const [shop, order] = await Promise.all([
    getShop(session.shop),
    getPackingOrder(session.shop, Number(params.orderId)),
  ]);
  if (!order) throw new Response("Not found", { status: 404 });

  if (isPackingDone(order)) return redirect(donePath(order.id));

  return {
    // Packed orders follow the mode they were packed in; this one applies when
    // packing finishes.
    fulfilling: order.packedAt
      ? order.fulfillAfterPacking
      : shop?.packingMode === "PACK_AND_FULFILL",
    order: {
      id: order.id,
      orderId: order.orderId,
      orderName: order.orderName,
      boxCode: order.boxCode,
      packed: order.packedAt !== null,
      fulfilled: order.fulfilledAt !== null,
      // Fulfilled or cancelled outside the app: the box was freed.
      released: order.boxKey === null && order.fulfilledAt === null,
      picking: order.round.status !== "COMPLETED",
      incomplete: order.lines.some((line) => line.short > 0),
      trackingCompany: order.trackingCompany,
      trackingNumber: order.trackingNumber,
    },
    lines: order.lines.filter((line) => line.expected > 0),
  };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { admin, session, sessionToken, redirect } =
    await authenticate.admin(request);
  const pickingOrderId = Number(params.orderId);
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const fail = (error: string): ActionResult => ({ ok: false, intent, error });

  try {
    switch (intent) {
      case "scan":
      case "plus": {
        const barcode = String(formData.get("barcode") ?? "").trim();
        if (intent === "scan" && !barcode) return fail("Scan a product.");
        const shop = await getShop(session.shop);
        const fulfillAfterPacking = shop?.packingMode === "PACK_AND_FULFILL";
        const complete = await packUnit(
          session.shop,
          pickingOrderId,
          intent === "plus"
            ? { lineId: Number(formData.get("lineId")) }
            : { barcode },
          sessionToken?.sub ?? null,
          fulfillAfterPacking,
        );
        if (complete) {
          const order = await getPackingOrder(session.shop, pickingOrderId);
          if (order) await tagPackedOrder(admin, order);
          // Pack only: done. Pack and fulfill: the page asks for tracking.
          if (!fulfillAfterPacking) return redirect(donePath(pickingOrderId));
        }
        return { ok: true, intent, complete };
      }
      case "minus":
        await unpackUnit(
          session.shop,
          pickingOrderId,
          Number(formData.get("lineId")),
        );
        return { ok: true, intent };
      case "fulfill": {
        const order = await getPackingOrder(session.shop, pickingOrderId);
        if (!order?.packedAt)
          return fail("Pack the order before fulfilling it.");

        const carrier = String(formData.get("carrier") ?? "");
        const other = carrier === OTHER_CARRIER;
        const company = (
          other ? String(formData.get("otherCarrier") ?? "") : carrier
        ).trim();
        const number = String(formData.get("trackingNumber") ?? "").trim();
        const url = String(formData.get("trackingUrl") ?? "").trim();
        if (!company) return fail("Select the carrier.");
        if (!number) return fail("Enter the tracking number.");
        if (other && url && !/^https?:\/\/\S+$/i.test(url)) {
          return fail("Enter a tracking URL starting with https://.");
        }

        await fulfillPackedOrder(
          admin,
          session.shop,
          {
            id: order.id,
            orderId: order.orderId,
            locationId: order.round.locationId,
          },
          { company, number, url: other && url ? url : null },
          formData.get("notifyCustomer") === "true",
        );
        return redirect(donePath(pickingOrderId));
      }
    }
  } catch (error) {
    if (error instanceof PackingError) return fail(error.message);
    throw error;
  }
  throw new Response("Bad request", { status: 400 });
};

export default function PackOrder() {
  const { order, lines, fulfilling } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const focused = useWindowFocus();
  const productField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const fulfillModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const trackingField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [pending, setPending] = useState<PendingAction>({
    message: "Packing…",
  });
  const [carrier, setCarrier] = useState<string>(CARRIERS[0]);
  const [otherCarrier, setOtherCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const activity = usePageActivity(fetcher.state !== "idle", pending);
  // Busy until the action is saved and, if it navigates, the next page loads.
  const busy = activity.active;
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const fulfillError =
    result && !result.ok && result.intent === "fulfill" ? result.error : null;

  const blocked = order.picking || order.incomplete || order.released;
  const packing = !blocked && !order.packed;
  const toFulfill =
    fulfilling && order.packed && !order.fulfilled && !order.released;
  const units = lines.reduce((sum, line) => sum + line.expected, 0);
  const packedUnits = lines.reduce((sum, line) => sum + line.packed, 0);

  // The order's last unit finishes packing (tag in Shopify, then the success
  // page or the tracking modal): block right away.
  const packUnit = (data: Record<string, string | number>) => {
    if (busy) {
      beep("error");
      return;
    }
    setPending(
      packedUnits === units - 1
        ? { message: "Finishing packing…", immediate: true }
        : { message: "Packing…" },
    );
    fetcher.submit(data, { method: "post" });
  };
  const scan = (code: string) => packUnit({ intent: "scan", barcode: code });
  useScanField(productField, {
    enabled: packing,
    onEnter: () => {
      if (!barcode.trim()) return;
      scan(barcode);
      setBarcode("");
    },
  });
  useBarcodeScanner(scan, { enabled: packing });
  // With the tracking modal open, a scan anywhere is the tracking number (the
  // field also takes focus when the modal opens). It doesn't submit: the packer
  // checks the carrier and confirms.
  useBarcodeScanner(
    (code) => {
      setTrackingNumber(code);
      trackingField.current?.focus();
      beep("success");
    },
    { enabled: fulfillOpen },
  );

  useEffect(() => {
    if (!result) return;
    if (result.intent === "scan" || !result.ok)
      beep(result.ok ? "success" : "error");
    // The modal was closed to show progress: bring it back with the error.
    if (!result.ok && result.intent === "fulfill") {
      fulfillModal.current?.showOverlay();
    } else if (!result.ok) {
      scanErrorToast(shopify, result.error);
    }
    if (!result.ok) return;
    // Pack and fulfill: once packed, go straight to tracking.
    if (result.complete) {
      shopify.toast.show(`${order.orderName} packed`);
      fulfillModal.current?.showOverlay();
    }
    // Only react to a new action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const status = order.fulfilled
    ? { label: "Fulfilled", tone: "success" as const }
    : order.packed
      ? {
          label: fulfilling ? "Packed · to fulfill" : "Packed",
          tone: "success" as const,
        }
      : { label: "Packing", tone: "info" as const };

  return (
    <s-page heading={order.orderName} inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/packing">
        Packing
      </s-link>
      {toFulfill && (
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor={FULFILL_MODAL_ID}
          command="--show"
        >
          Fulfill order
        </s-button>
      )}
      <s-button
        slot="secondary-actions"
        icon="external"
        href={`shopify://admin/orders/${legacyId(order.orderId)}`}
        target="_blank"
      >
        View in Shopify
      </s-button>

      <s-query-container>
        <s-stack gap="base">
          {/* Order, box and progress */}
          <s-section accessibilityLabel="Order">
            <s-stack gap="base">
              <s-grid
                gridTemplateColumns="1fr auto"
                alignItems="center"
                gap="small"
              >
                <s-stack direction="inline" gap="small-300" alignItems="center">
                  <s-icon type="package" />
                  <s-text color="subdued">Box</s-text>
                  <s-text type="strong">{order.boxCode ?? "—"}</s-text>
                </s-stack>
                <s-badge tone={status.tone}>{status.label}</s-badge>
              </s-grid>
              <s-stack gap="small-300">
                <s-progress
                  value={packedUnits}
                  max={Math.max(units, 1)}
                  tone={packedUnits === units ? "success" : "auto"}
                  accessibilityLabel="Units packed"
                />
                <s-text color="subdued">{`${packedUnits} of ${units} units packed`}</s-text>
              </s-stack>
            </s-stack>
          </s-section>

          {order.picking && (
            <s-banner tone="warning" heading="Still being picked">
              This order&apos;s picking round isn&apos;t finished yet.
            </s-banner>
          )}
          {order.incomplete && (
            <s-banner tone="critical" heading="Missing items">
              Some units weren&apos;t found when picking, so this order
              can&apos;t be packed.
            </s-banner>
          )}
          {order.released && (
            <s-banner tone="info" heading="Already handled in Shopify">
              This order was fulfilled or cancelled in Shopify and its box was
              freed.
            </s-banner>
          )}

          {/* Scanning products */}
          {packing && (
            <s-section accessibilityLabel="Scan products">
              <s-stack gap="base">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!barcode.trim()) return;
                    scan(barcode);
                    setBarcode("");
                  }}
                >
                  {/* Enter submits (scanners send it; so does the phone keyboard). */}
                  <s-text-field
                    ref={productField}
                    label="Scan each product"
                    placeholder="Scan or type the product barcode"
                    details={
                      focused
                        ? undefined
                        : "Scanner paused: tap anywhere on this page so it receives scans."
                    }
                    icon="barcode"
                    autocomplete="off"
                    value={barcode}
                    onInput={(event) => setBarcode(event.currentTarget.value)}
                  />
                </form>
              </s-stack>
            </s-section>
          )}

          {/* Packed, waiting for tracking ("Later" in the modal) */}
          {toFulfill && (
            <s-section heading="Fulfillment">
              <s-stack gap="base">
                <s-paragraph>
                  Packed. Add the carrier and tracking number to fulfill it in
                  Shopify.
                </s-paragraph>
                <s-stack
                  direction="inline"
                  gap="small-200"
                  justifyContent="end"
                >
                  <s-button href="/app/packing">Back to packing</s-button>
                  <s-button
                    variant="primary"
                    commandFor={FULFILL_MODAL_ID}
                    command="--show"
                  >
                    Fulfill order
                  </s-button>
                </s-stack>
              </s-stack>
            </s-section>
          )}

          {/* Products: one card each */}
          <s-section heading="Products">
            <s-badge slot="accessory">{lines.length}</s-badge>
            <s-stack gap="small">
              {lines.map((line) => {
                const complete = line.packed >= line.expected;
                return (
                  <s-box
                    key={line.id}
                    padding="base"
                    borderRadius="large"
                    background={complete ? "subdued" : "base"}
                    border={complete ? "none" : "base"}
                  >
                    <s-grid
                      gridTemplateColumns="@container (inline-size <= 480px) 48px 1fr auto, 64px 1fr auto"
                      alignItems="center"
                      gap="base"
                    >
                      <s-box
                        border="base"
                        borderRadius="base"
                        overflow="hidden"
                        background="subdued"
                      >
                        {line.imageUrl ? (
                          <s-image
                            src={sizedImageUrl(line.imageUrl, 128)}
                            alt={line.productTitle}
                            aspectRatio="1/1"
                            objectFit="contain"
                          />
                        ) : (
                          <s-stack alignItems="center" padding="small">
                            <s-icon type="product" tone="neutral" />
                          </s-stack>
                        )}
                      </s-box>
                      <s-stack gap="small-500">
                        <s-text type="strong">{line.productTitle}</s-text>
                        <s-text color="subdued">
                          {[line.variantTitle, line.sku, line.barcode]
                            .filter(Boolean)
                            .join(" · ")}
                        </s-text>
                      </s-stack>
                      <s-stack
                        direction="inline"
                        gap="small"
                        alignItems="center"
                      >
                        {complete && (
                          <s-icon type="check-circle" tone="success" />
                        )}
                        {/* Same order as picking: − quantity + */}
                        {packing && (
                          <s-button
                            icon="minus"
                            accessibilityLabel={`Take one ${line.productTitle} out of the parcel`}
                            disabled={line.packed === 0 || busy}
                            onClick={() => {
                              setPending({ message: "Undoing…" });
                              fetcher.submit(
                                { intent: "minus", lineId: line.id },
                                { method: "post" },
                              );
                            }}
                          />
                        )}
                        <s-heading>{`${line.packed}/${line.expected}`}</s-heading>
                        {packing && (
                          <s-button
                            icon="plus"
                            accessibilityLabel={`Check one ${line.productTitle} into the parcel`}
                            disabled={complete || busy}
                            onClick={() =>
                              packUnit({ intent: "plus", lineId: line.id })
                            }
                          />
                        )}
                      </s-stack>
                    </s-grid>
                  </s-box>
                );
              })}
            </s-stack>
          </s-section>
        </s-stack>
      </s-query-container>

      <s-modal
        ref={fulfillModal}
        id={FULFILL_MODAL_ID}
        heading={`Fulfill ${order.orderName}`}
        onShow={() => setFulfillOpen(true)}
        onAfterShow={() => trackingField.current?.focus()}
        onHide={() => setFulfillOpen(false)}
      >
        <s-stack gap="base">
          {fulfillError && (
            <s-banner tone="critical" heading="Not fulfilled">
              {fulfillError}
            </s-banner>
          )}
          <s-select
            label="Carrier"
            value={carrier}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCarrier(value);
              // Next comes the tracking number (unless the carrier name must
              // be typed): keep scans out of the select.
              if (value !== OTHER_CARRIER) trackingField.current?.focus();
            }}
          >
            {CARRIERS.map((name) => (
              <s-option key={name} value={name}>
                {name}
              </s-option>
            ))}
            <s-option value={OTHER_CARRIER}>Other</s-option>
          </s-select>
          {carrier === OTHER_CARRIER && (
            <>
              <s-text-field
                label="Carrier name"
                maxLength={TRACKING_MAX_LENGTH}
                value={otherCarrier}
                onInput={(event) => setOtherCarrier(event.currentTarget.value)}
              />
              <s-text-field
                label="Tracking URL"
                details="Shopify can't build tracking links for this carrier."
                placeholder="https://"
                maxLength={TRACKING_MAX_LENGTH}
                value={trackingUrl}
                onInput={(event) => setTrackingUrl(event.currentTarget.value)}
              />
            </>
          )}
          <s-text-field
            ref={trackingField}
            label="Tracking number"
            placeholder="Scan or type the tracking number"
            icon="barcode"
            autocomplete="off"
            maxLength={TRACKING_MAX_LENGTH}
            value={trackingNumber}
            onInput={(event) => setTrackingNumber(event.currentTarget.value)}
          />
          <s-checkbox
            label="Send shipping confirmation to the customer"
            checked={notifyCustomer}
            onChange={(event) => setNotifyCustomer(event.currentTarget.checked)}
          />
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={busy}
          onClick={() => {
            // Closed while Shopify fulfills, so the progress is visible; it
            // reopens with the error if it fails.
            fulfillModal.current?.hideOverlay();
            setPending({ message: "Fulfilling in Shopify…", immediate: true });
            fetcher.submit(
              {
                intent: "fulfill",
                carrier,
                otherCarrier,
                trackingNumber,
                trackingUrl,
                notifyCustomer: String(notifyCustomer),
              },
              { method: "post" },
            );
          }}
        >
          Fulfill
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={FULFILL_MODAL_ID}
          command="--hide"
        >
          Later
        </s-button>
      </s-modal>

      <BlockingOverlay {...activity} />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
