import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getPackingOrder, isPackingDone } from "../models/packing.server";
import { tagPackedOrder } from "../services/packing.server";
import { SuccessState } from "../components/SuccessState";
import { beep } from "../utils/feedback";
import { PACKED_ORDER_TAG } from "../utils/packing";

// End of packing an order (after fulfilling it, in pack-and-fulfill mode),
// like the picking success page: what happened, and back to scanning boxes.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const order = await getPackingOrder(session.shop, Number(params.orderId));
  if (!order) throw new Response("Not found", { status: 404 });

  if (!isPackingDone(order)) return redirect(`/app/packing/${order.id}`);

  // Retries the "packed" tag if adding it failed when packing finished.
  const tagged = await tagPackedOrder(admin, order);

  return {
    tagged,
    order: {
      orderName: order.orderName,
      boxCode: order.boxCode,
      units: order.lines.reduce((sum, line) => sum + line.packed, 0),
      fulfilled: order.fulfilledAt !== null,
      trackingCompany: order.trackingCompany,
      trackingNumber: order.trackingNumber,
    },
  };
};

export default function PackingDone() {
  const { order, tagged } = useLoaderData<typeof loader>();

  // The last scan (or the fulfillment) brought the packer here: confirm it by
  // sound too.
  useEffect(() => beep("success"), []);

  return (
    <s-page heading={order.orderName} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/packing">
        Packing
      </s-link>

      <SuccessState
        heading={order.fulfilled ? "Packed and fulfilled" : "Packed"}
        message={
          order.fulfilled
            ? `${order.orderName} is on its way with ${order.trackingCompany ?? "the carrier"}${order.trackingNumber ? ` · ${order.trackingNumber}` : ""}.`
            : `${order.orderName} is packed and ready to ship.`
        }
        details={[
          { label: "Order", value: order.orderName },
          { label: "Box", value: order.boxCode ?? "—" },
          { label: "Units", value: order.units },
        ]}
        notice={
          !tagged && (
            <s-banner tone="warning" heading="Order not tagged">
              {`Couldn't add the "${PACKED_ORDER_TAG}" tag in Shopify. Reload this page to try again.`}
            </s-banner>
          )
        }
        action={{ label: "Pack next box", href: "/app/packing" }}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
