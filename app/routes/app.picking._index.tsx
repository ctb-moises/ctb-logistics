import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { listPickingRounds } from "../models/picking.server";
import {
  financialStatusLabel,
  PICKING_STATUSES,
  pickingStatus,
  type PickingStatus,
} from "../utils/picking";

const VIEWS: { value: PickingStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...PICKING_STATUSES.map((status) => ({
    value: status.value,
    label: status.label,
  })),
];

function parseCursor(value: string | null) {
  const id = Number(value);
  return value && Number.isInteger(id) ? id : undefined;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status =
    pickingStatus(url.searchParams.get("status") ?? "")?.value ?? null;

  const page = await listPickingRounds(session.shop, {
    status,
    after: parseCursor(url.searchParams.get("after")),
    before: parseCursor(url.searchParams.get("before")),
  });

  return {
    status,
    ...page,
    rounds: page.rounds.map((round) => ({
      ...round,
      createdAt: round.createdAt.toISOString(),
    })),
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

export default function PickingRounds() {
  const { rounds, status, hasNextPage, hasPreviousPage } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentView = VIEWS.find((view) => view.value === (status ?? "all"))!;

  const setView = (value: string) => {
    const params = new URLSearchParams();
    if (value !== "all") params.set("status", value);
    setSearchParams(params, { replace: true });
  };

  const goToPage = (cursor: "after" | "before", id: number) => {
    const params = new URLSearchParams(searchParams);
    params.delete("after");
    params.delete("before");
    params.set(cursor, String(id));
    setSearchParams(params);
  };

  const noRoundsYet = rounds.length === 0 && !status && !hasPreviousPage;

  return (
    <s-page heading="Picking">
      <s-button slot="primary-action" variant="primary" href="/app/picking/new">
        New picking round
      </s-button>

      {noRoundsYet ? (
        <s-section>
          <s-empty-state heading="Start your first picking round">
            <s-paragraph slot="subheading">
              Pick a batch of orders together, with one box per order.
            </s-paragraph>
            <s-button
              slot="primary-action"
              variant="primary"
              href="/app/picking/new"
            >
              New picking round
            </s-button>
          </s-empty-state>
        </s-section>
      ) : (
        <s-section padding="none" accessibilityLabel="Picking rounds">
          <s-table
            paginate
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => goToPage("after", rounds[rounds.length - 1].id)}
            onPreviousPage={() => goToPage("before", rounds[0].id)}
            loading={navigation.state === "loading"}
          >
            <s-grid
              slot="filters"
              gap="small-200"
              gridTemplateColumns="auto 1fr"
              alignItems="center"
            >
              <s-clickable
                commandFor="picking-view-menu"
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
              <s-menu id="picking-view-menu" accessibilityLabel="Picking views">
                {VIEWS.map((view) => (
                  <s-button
                    key={view.value}
                    icon={view.value === currentView.value ? "check" : "blank"}
                    onClick={() => setView(view.value)}
                  >
                    {view.label}
                  </s-button>
                ))}
              </s-menu>
            </s-grid>

            <s-table-header-row>
              <s-table-header listSlot="primary">Round</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header>Payment status</s-table-header>
              <s-table-header>Order tag</s-table-header>
              <s-table-header format="numeric">Orders</s-table-header>
              <s-table-header>Created</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rounds.map((round) => {
                const roundStatus = pickingStatus(round.status);
                const inProgress = round.status === "IN_PROGRESS";
                return (
                  <s-table-row
                    key={round.id}
                    clickDelegate={`round-link-${round.id}`}
                  >
                    <s-table-cell>
                      {/* In-progress rounds resume where they are (step 2, or step
                          3 via redirect); completed rounds open their summary. */}
                      <s-link
                        id={`round-link-${round.id}`}
                        href={
                          inProgress
                            ? `/app/picking/${round.id}`
                            : `/app/picking/${round.id}/summary`
                        }
                      >
                        #{round.id}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        color="base"
                        tone={roundStatus?.tone ?? "neutral"}
                      >
                        {roundStatus?.label ?? round.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {financialStatusLabel(round.financialStatus)}
                    </s-table-cell>
                    <s-table-cell>{round.orderTag ?? "—"}</s-table-cell>
                    <s-table-cell>{round._count.orders}</s-table-cell>
                    <s-table-cell>
                      <time dateTime={round.createdAt} suppressHydrationWarning>
                        {formatDate(round.createdAt)}
                      </time>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          {rounds.length === 0 && (
            <s-box padding="large">
              <s-empty-state heading="No picking rounds found">
                <s-paragraph slot="subheading">
                  Try changing the view.
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
