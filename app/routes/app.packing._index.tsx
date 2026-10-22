import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import { findBoxForPacking, listBoxesToPack } from "../models/packing.server";
import {
  useBarcodeScanner,
  useScanField,
  useWindowFocus,
} from "../hooks/useBarcodeScanner";
import { beep } from "../utils/feedback";
import { BOX_CODE_MAX_LENGTH, normalizeBoxCode } from "../utils/picking";

// Packing starts by scanning a box: it opens the order inside it.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop?.locationId) return { configured: false as const };

  const boxes = await listBoxesToPack(session.shop, shop.locationId);
  return {
    configured: true as const,
    boxes: boxes.map((box) => ({ ...box, packed: box.packedAt !== null })),
  };
};

// Also used by the order page to open the next box.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const boxCode = normalizeBoxCode(String(formData.get("boxCode") ?? ""));
  if (!boxCode) return { error: "Scan a box." };

  const box = await findBoxForPacking(session.shop, boxCode);
  switch (box.status) {
    case "ready":
      return redirect(`/app/packing/${box.id}`);
    case "not-found":
      return { error: `Box ${boxCode} isn't holding an order to pack.` };
    case "picking":
      return {
        error: `${box.orderName} in box ${boxCode} is still being picked (round #${box.roundId}).`,
      };
    case "incomplete":
      return {
        error: `${box.orderName} in box ${boxCode} has missing items, so it can't be packed.`,
      };
    case "done":
      return { error: `${box.orderName} in box ${boxCode} is already done.` };
  }
};

export default function Packing() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const focused = useWindowFocus();
  const boxField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const [boxCode, setBoxCode] = useState("");
  const busy = fetcher.state !== "idle";
  const error = fetcher.state === "idle" ? fetcher.data?.error : undefined;

  const open = (code: string) => {
    if (busy || !code.trim()) return;
    fetcher.submit({ boxCode: code }, { method: "post" });
  };
  const submitField = () => {
    open(boxCode);
    setBoxCode("");
  };

  const scanning = data.configured;
  useScanField(boxField, { enabled: scanning, onEnter: submitField });
  useBarcodeScanner(open, { enabled: scanning });

  // A rejected box: error sound (opening a box navigates away).
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) beep("error");
  }, [fetcher.state, fetcher.data]);

  if (!data.configured) {
    return (
      <s-page heading="Packing" inlineSize="small">
        <s-section>
          <s-empty-state heading="Select a warehouse">
            <s-paragraph slot="subheading">
              Packing works on the boxes picked in one Shopify location. Choose
              it in Settings.
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

  const { boxes } = data;
  const toFulfill = boxes.some((box) => box.packed);

  return (
    <s-page heading="Packing" inlineSize="base">
      <s-query-container>
        <s-stack gap="base">
          <s-section heading="Scan a box">
            <s-stack gap="base">
              {error ? (
                <s-banner tone="critical" heading="Can't open this box">
                  {error}
                </s-banner>
              ) : !focused ? (
                <s-banner tone="warning" heading="Scanner paused">
                  Click anywhere on this page so it can receive scans.
                </s-banner>
              ) : (
                <s-banner tone="info" heading="Ready to scan">
                  Scan a picked box to pack its order.
                </s-banner>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitField();
                }}
              >
                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="small-200"
                  alignItems="end"
                >
                  <s-text-field
                    ref={boxField}
                    label="Box code"
                    placeholder="Scan or type the box code"
                    icon="barcode"
                    autocomplete="off"
                    maxLength={BOX_CODE_MAX_LENGTH}
                    value={boxCode}
                    onInput={(event) => setBoxCode(event.currentTarget.value)}
                  />
                  <s-button type="submit" loading={busy}>
                    Open
                  </s-button>
                </s-grid>
              </form>
            </s-stack>
          </s-section>

          <s-section
            heading={
              toFulfill ? "Waiting to pack or fulfill" : "Waiting to pack"
            }
            padding="none"
          >
            <s-badge slot="accessory">{boxes.length}</s-badge>
            {boxes.length === 0 ? (
              <s-box padding="base">
                <s-paragraph color="subdued">
                  No picked boxes are waiting. Finish a picking round to fill
                  this list.
                </s-paragraph>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header>Box</s-table-header>
                  <s-table-header>Round</s-table-header>
                  <s-table-header format="numeric">Items</s-table-header>
                  <s-table-header listSlot="secondary">Status</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {boxes.map((box) => (
                    <s-table-row
                      key={box.id}
                      clickDelegate={`box-link-${box.id}`}
                    >
                      <s-table-cell>
                        <s-link
                          id={`box-link-${box.id}`}
                          href={`/app/packing/${box.id}`}
                        >
                          {box.orderName}
                        </s-link>
                      </s-table-cell>
                      <s-table-cell>{box.boxCode}</s-table-cell>
                      <s-table-cell>#{box.roundId}</s-table-cell>
                      <s-table-cell>{box.itemCount}</s-table-cell>
                      <s-table-cell>
                        {box.packed ? (
                          <s-badge tone="info">To fulfill</s-badge>
                        ) : (
                          <s-badge tone="neutral">To pack</s-badge>
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
