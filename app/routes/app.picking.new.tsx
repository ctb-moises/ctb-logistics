import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getShop } from "../models/shop.server";
import { getPickingRound } from "../models/picking.server";
import { reserveRoundOrders } from "../services/picking.server";
import { PickingSteps } from "../components/PickingSteps";
import {
  FINANCIAL_STATUSES,
  isFinancialStatus,
  ORDER_TAG_MAX_LENGTH,
  parseBatchSizes,
} from "../utils/picking";

const DEFAULT_BATCH_SIZES = [1, 4, 8, 16, 32];

// Step 1 of the picking wizard: order filters. With ?round=<id> it edits the
// filters of an in-progress round (coming back from step 2).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop?.locationId) return { configured: false as const };

  const roundId = Number(new URL(request.url).searchParams.get("round"));
  const round = Number.isInteger(roundId)
    ? await getPickingRound(session.shop, roundId)
    : null;
  const batchSizes =
    parseBatchSizes(shop.pickingBatchSizes) ?? DEFAULT_BATCH_SIZES;

  return {
    configured: true as const,
    locationName: shop.locationName,
    batchSizes,
    round:
      round?.status === "IN_PROGRESS"
        ? {
            id: round.id,
            financialStatus: round.financialStatus,
            orderTag: round.orderTag,
            orderLimit: round.orderLimit,
          }
        : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken, redirect } =
    await authenticate.admin(request);
  const shop = await getShop(session.shop);
  if (!shop?.locationId)
    return { errors: { form: "Select a warehouse first." } };

  const formData = await request.formData();
  const financialStatus = String(formData.get("financialStatus") ?? "");
  const orderTag = String(formData.get("orderTag") ?? "").trim();
  const orderLimit = Number(formData.get("orderLimit"));
  const batchSizes =
    parseBatchSizes(shop.pickingBatchSizes) ?? DEFAULT_BATCH_SIZES;

  const errors: {
    financialStatus?: string;
    orderTag?: string;
    orderLimit?: string;
  } = {};
  if (!isFinancialStatus(financialStatus)) {
    errors.financialStatus = "Select a payment status.";
  }
  if (orderTag.length > ORDER_TAG_MAX_LENGTH) {
    errors.orderTag = `Use ${ORDER_TAG_MAX_LENGTH} characters or fewer.`;
  }
  if (!batchSizes.includes(orderLimit)) {
    errors.orderLimit = "Select how many orders to pick.";
  }
  if (Object.keys(errors).length > 0 || !isFinancialStatus(financialStatus)) {
    return { errors };
  }

  const filters = {
    financialStatus,
    orderTag: orderTag || null,
    orderLimit,
  };
  const editedRoundId = Number(formData.get("roundId"));
  // Reserves the orders now, so a concurrent round can't take them.
  const result = await reserveRoundOrders(
    admin,
    session.shop,
    shop.locationId,
    sessionToken?.sub ?? null,
    filters,
    Number.isInteger(editedRoundId) && editedRoundId > 0 ? editedRoundId : null,
  );
  if (!result.ok) {
    return {
      errors: {
        form:
          result.reason === "no-orders"
            ? "No orders to pick match these filters. Orders already in another picking round are skipped."
            : "Filters can't change after boxes are assigned.",
      },
    };
  }
  return redirect(`/app/picking/${result.roundId}`);
};

export default function NewPickingRound() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const errors = actionData?.errors as Record<string, string> | undefined;

  if (!data.configured) {
    return (
      <s-page heading="New picking round" inlineSize="small">
        <s-section>
          <s-empty-state heading="Select a warehouse">
            <s-paragraph slot="subheading">
              Picking runs against one Shopify location. Choose it in Settings.
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

  const { round, batchSizes, locationName } = data;

  return (
    <s-page heading="New picking round" inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/picking">
        Picking
      </s-link>
      <Form method="post">
        {round && <input type="hidden" name="roundId" value={round.id} />}
        <s-stack gap="base">
          <PickingSteps current={1} />
          {errors?.form && (
            <s-banner
              tone="warning"
              heading={round ? "Round not updated" : "Round not started"}
            >
              {errors.form}
            </s-banner>
          )}

          <s-section
            heading="Orders"
            subheading={`Unfulfilled orders in ${locationName} that match these filters are picked in this round.`}
          >
            <s-select
              name="financialStatus"
              label="Payment status"
              value={round?.financialStatus ?? "paid"}
              error={errors?.financialStatus}
            >
              {FINANCIAL_STATUSES.map((status) => (
                <s-option key={status.value} value={status.value}>
                  {status.label}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              name="orderTag"
              label="Order tag"
              details="Optional. Only orders with this tag are picked."
              maxLength={ORDER_TAG_MAX_LENGTH}
              value={round?.orderTag ?? ""}
              error={errors?.orderTag}
            />
            <s-select
              name="orderLimit"
              label="Orders in this round"
              value={String(round?.orderLimit ?? batchSizes[0])}
              error={errors?.orderLimit}
            >
              {batchSizes.map((size) => (
                <s-option key={size} value={String(size)}>
                  {size === 1 ? "1 order" : `${size} orders`}
                </s-option>
              ))}
            </s-select>
          </s-section>

          <s-stack direction="inline" gap="small-200" justifyContent="end">
            <s-button href="/app/picking">Cancel</s-button>
            <s-button
              type="submit"
              variant="primary"
              loading={navigation.state !== "idle"}
            >
              Next
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
