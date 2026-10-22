import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getRoundTotals } from "../models/picking-run.server";
import { SuccessState } from "../components/SuccessState";
import { tagPickedOrders } from "../services/picking.server";
import { PICKED_ORDER_TAG } from "../utils/picking";

// End of the picking wizard: shown once, right after the last item is picked.
// The round's details are opened from the rounds list.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const totals = await getRoundTotals(session.shop, Number(params.roundId));
  if (!totals) throw new Response("Not found", { status: 404 });
  if (totals.status !== "COMPLETED") {
    return redirect(`/app/picking/${totals.id}`);
  }
  // Retries tagging orders the last pick couldn't tag (no-op once all are).
  let untagged = 0;
  try {
    untagged = await tagPickedOrders(admin, totals.id);
  } catch (error) {
    console.error(`Tagging orders of picking round ${totals.id} failed`, error);
    untagged = -1;
  }
  return { totals, untagged };
};

export default function PickingRoundDone() {
  const { totals, untagged } = useLoaderData<typeof loader>();
  const complete = totals.missing === 0;

  return (
    <s-page heading={`Picking round #${totals.id}`} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/picking">
        Picking
      </s-link>

      <SuccessState
        tone={complete ? "success" : "warning"}
        heading="Picking complete"
        message={
          complete
            ? `All ${totals.orders} ${totals.orders === 1 ? "order is" : "orders are"} in their boxes, ready to pack.`
            : `${totals.missing} ${totals.missing === 1 ? "unit is" : "units are"} missing in ${totals.incompleteOrders} of ${totals.orders} orders. Open the round in Picking to see which.`
        }
        details={[
          { label: "Orders", value: totals.orders },
          { label: "Picked", value: totals.picked },
          { label: "Missing", value: totals.missing },
        ]}
        notice={
          untagged !== 0 && (
            <s-banner tone="warning" heading="Orders not tagged">
              {`Some orders couldn't get the "${PICKED_ORDER_TAG}" tag in Shopify. Reload this page to try again.`}
            </s-banner>
          )
        }
        action={{ label: "Back to picking rounds", href: "/app/picking" }}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
