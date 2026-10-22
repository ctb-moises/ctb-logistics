import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { cancelRound } from "../models/picking.server";
import {
  completeRoundIfDone,
  findStepByBarcode,
  getPickingRun,
  getStepProduct,
  PickingError,
  pickUnit,
  skipStep,
  unpickUnit,
} from "../models/picking-run.server";
import { ensurePickingPlan } from "../services/picking.server";
import { DisplayText } from "../components/DisplayText";
import { PickingSteps } from "../components/PickingSteps";
import {
  useBarcodeScanner,
  useScanField,
  useWindowFocus,
} from "../hooks/useBarcodeScanner";
import { beep } from "../utils/feedback";
import { sizedImageUrl } from "../utils/images";

const CANCEL_MODAL_ID = "cancel-round-modal";
const MISSING_MODAL_ID = "mark-missing-modal";
// Pause on a completed step before moving on, so the picker sees it's done.
const AUTO_ADVANCE_MS = 1000;

type ActionResult =
  | {
      ok: true;
      intent: string;
      stepComplete?: boolean;
      roundComplete?: boolean;
    }
  | { ok: false; intent: string; error: string };

// Step 3 of the picking wizard: walk the route, one product in one bin per step,
// scanning each unit into the boxes in the cart.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const roundId = Number(params.roundId);

  await ensurePickingPlan(admin, session.shop, roundId);
  const run = await getPickingRun(session.shop, roundId);
  if (!run) throw new Response("Not found", { status: 404 });
  if (!run.plannedAt) return redirect(`/app/picking/${roundId}`);
  // A completed round (e.g. right after its last pick) shows its summary.
  if (run.status === "COMPLETED") {
    return redirect(`/app/picking/${roundId}/summary`);
  }

  const orders = new Map(run.orders.map((order) => [order.id, order]));
  const lines = new Map(run.lines.map((line) => [line.id, line]));

  const steps: {
    step: number;
    binCode: string | null;
    product: (typeof run.lines)[number];
    done: boolean;
    tasks: {
      id: number;
      quantity: number;
      picked: number;
      short: number;
      orderName: string;
      boxCode: string | null;
      slot: number;
    }[];
  }[] = [];
  for (const task of run.tasks) {
    const line = lines.get(task.lineId)!;
    const order = orders.get(line.pickingOrderId)!;
    let step = steps.at(-1);
    if (step?.step !== task.step) {
      step = {
        step: task.step,
        binCode: task.binCode,
        product: line,
        done: true,
        tasks: [],
      };
      steps.push(step);
    }
    step.tasks.push({
      id: task.id,
      quantity: task.quantity,
      picked: task.picked,
      short: task.short,
      orderName: order.orderName,
      boxCode: order.boxCode,
      slot: order.slot ?? 0,
    });
    if (task.picked + task.short < task.quantity) step.done = false;
  }
  for (const step of steps) step.tasks.sort((a, b) => a.slot - b.slot);

  const total = run.tasks.reduce((sum, task) => sum + task.quantity, 0);
  const picked = run.tasks.reduce((sum, task) => sum + task.picked, 0);
  const short = run.tasks.reduce((sum, task) => sum + task.short, 0);

  return {
    round: { id: run.id, status: run.status },
    steps,
    totals: { total, picked, short },
  };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { session, sessionToken, redirect } = await authenticate.admin(request);
  const roundId = Number(params.roundId);
  const context = { shop: session.shop, userId: sessionToken?.sub ?? null };
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const step = Number(formData.get("step"));
  const taskId = Number(formData.get("taskId"));
  const fail = (error: string): ActionResult => ({ ok: false, intent, error });

  try {
    switch (intent) {
      case "scan":
      case "plus": {
        if (intent === "scan") {
          const barcode = String(formData.get("barcode") ?? "").trim();
          const product = await getStepProduct(roundId, step);
          if (!product) return fail("Step not found.");
          if (!product.barcode) {
            return fail(
              `${product.productTitle} has no barcode in Shopify. Use + to pick it.`,
            );
          }
          if (barcode !== product.barcode) {
            const other = await findStepByBarcode(roundId, barcode);
            return fail(
              other
                ? `That's ${other.productTitle}${other.step ? `, picked at step ${other.step}` : ""}, not ${product.productTitle}.`
                : `Barcode ${barcode} doesn't match ${product.productTitle}.`,
            );
          }
        }
        const stepComplete = await pickUnit(
          context,
          roundId,
          step,
          intent === "plus" ? taskId : null,
        );
        const roundComplete =
          stepComplete && (await completeRoundIfDone(session.shop, roundId));
        return { ok: true, intent, stepComplete, roundComplete };
      }
      case "minus":
        await unpickUnit(context, roundId, taskId);
        return { ok: true, intent };
      case "skip": {
        await skipStep(session.shop, roundId, step);
        const roundComplete = await completeRoundIfDone(session.shop, roundId);
        return { ok: true, intent, stepComplete: true, roundComplete };
      }
      case "cancel-round":
        await cancelRound(session.shop, roundId, context.userId);
        return redirect("/app/picking");
    }
  } catch (error) {
    if (error instanceof PickingError) return fail(error.message);
    throw error;
  }
  throw new Response("Bad request", { status: 400 });
};

export default function PickingRun() {
  const { round, steps, totals } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const focused = useWindowFocus();
  const [searchParams, setSearchParams] = useSearchParams();
  const productField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const [barcode, setBarcode] = useState("");

  const inProgress = round.status === "IN_PROGRESS";
  const firstOpen = steps.find((step) => !step.done) ?? steps.at(-1);
  const current =
    steps.find((step) => step.step === Number(searchParams.get("step"))) ??
    firstOpen;
  const currentIndex = current ? steps.indexOf(current) : -1;
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const scanError = result && !result.ok ? result.error : null;
  const scanning = inProgress && !!current && !current.done;

  const goToStep = (step: number) =>
    setSearchParams({ step: String(step) }, { replace: true });

  const submit = (data: Record<string, string | number>) => {
    if (!current) return;
    fetcher.submit({ step: current.step, ...data }, { method: "post" });
  };

  const scan = (code: string) => {
    if (busy) {
      beep("error");
      shopify.toast.show("Wait for the previous scan to finish", {
        isError: true,
      });
      return;
    }
    submit({ intent: "scan", barcode: code });
  };

  const submitField = () => {
    if (!barcode.trim()) return;
    scan(barcode);
    setBarcode("");
  };

  useScanField(productField, { enabled: scanning, onEnter: submitField });
  useBarcodeScanner(scan, { enabled: scanning });

  // Sound for every scan; after a step completes, move on to the next step
  // still to pick.
  useEffect(() => {
    if (!result) return;
    if (result.intent === "scan" || !result.ok)
      beep(result.ok ? "success" : "error");
    productField.current?.focus();
    if (!result.ok || !result.stepComplete || result.roundComplete) return;

    const next =
      steps.slice(currentIndex + 1).find((step) => !step.done) ??
      steps.find((step) => !step.done);
    if (!next) return;
    const timer = setTimeout(() => goToStep(next.step), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
    // Only react to a new action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const progress = totals.picked + totals.short;

  type StepTask = NonNullable<typeof current>["tasks"][number];
  const quantityControls = (task: StepTask, complete: boolean) => (
    <s-stack
      direction="inline"
      gap="small"
      alignItems="center"
      justifyContent="end"
    >
      {task.short > 0 && (
        <s-badge tone="critical">{`${task.short} missing`}</s-badge>
      )}
      {complete && task.short === 0 && (
        <s-icon type="check-circle" tone="success" />
      )}
      {inProgress && (
        <s-button
          icon="minus"
          accessibilityLabel={`Remove one unit from ${task.boxCode}`}
          disabled={task.picked === 0 || busy}
          onClick={() => submit({ intent: "minus", taskId: task.id })}
        />
      )}
      <s-text type="strong">{`${task.picked}/${task.quantity}`}</s-text>
      {inProgress && (
        <s-button
          icon="plus"
          accessibilityLabel={`Add one unit to ${task.boxCode}`}
          disabled={complete || busy}
          onClick={() => submit({ intent: "plus", taskId: task.id })}
        />
      )}
    </s-stack>
  );

  const cancelModal = (
    <s-modal
      id={CANCEL_MODAL_ID}
      heading={`Cancel picking round #${round.id}?`}
      size="small"
    >
      <s-paragraph>
        Picked units go back to their bins in the app, the orders are released
        and the boxes freed. Put the items back on the shelves. This can&apos;t
        be undone.
      </s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        loading={busy}
        onClick={() =>
          fetcher.submit({ intent: "cancel-round" }, { method: "post" })
        }
      >
        Cancel round
      </s-button>
      <s-button
        slot="secondary-actions"
        commandFor={CANCEL_MODAL_ID}
        command="--hide"
      >
        Keep picking
      </s-button>
    </s-modal>
  );

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
          <PickingSteps current={3} />

          <s-section accessibilityLabel="Picking progress">
            <s-stack gap="small-300">
              <s-grid gridTemplateColumns="1fr auto" alignItems="center">
                <s-text type="strong">
                  {current
                    ? `Step ${currentIndex + 1} of ${steps.length}`
                    : "No items to pick"}
                </s-text>
                <s-text color="subdued">
                  {`${totals.picked} of ${totals.total} units picked`}
                  {totals.short > 0 ? ` · ${totals.short} missing` : ""}
                </s-text>
              </s-grid>
              <s-progress
                value={progress}
                max={Math.max(totals.total, 1)}
                tone={
                  totals.short > 0
                    ? "critical"
                    : progress === totals.total
                      ? "success"
                      : "auto"
                }
                accessibilityLabel="Picking progress"
              />
            </s-stack>
          </s-section>

          {current && (
            <>
              {/* The bin guides the picker along the route: first and largest. */}
              <s-section accessibilityLabel="Product to pick">
                <s-stack gap="base">
                  <s-box
                    background="strong"
                    borderRadius="large"
                    padding="base"
                  >
                    <s-grid
                      gridTemplateColumns="1fr auto"
                      alignItems="center"
                      gap="base"
                    >
                      <s-stack gap="small-400">
                        <s-stack
                          direction="inline"
                          gap="small-300"
                          alignItems="center"
                        >
                          <s-icon type="location" />
                          <s-text color="subdued">Bin</s-text>
                        </s-stack>
                        <DisplayText align="start">
                          {current.binCode ?? "No bin"}
                        </DisplayText>
                      </s-stack>
                      <s-stack gap="small-400" alignItems="center">
                        <s-text color="subdued">Pick</s-text>
                        <DisplayText>
                          {current.tasks.reduce(
                            (sum, task) => sum + task.quantity,
                            0,
                          )}
                        </DisplayText>
                      </s-stack>
                    </s-grid>
                  </s-box>

                  <s-grid
                    gridTemplateColumns="@container (inline-size <= 480px) 72px 1fr, 112px 1fr"
                    gap="base"
                    alignItems="center"
                  >
                    <s-box
                      border="base"
                      borderRadius="large"
                      background="subdued"
                      overflow="hidden"
                    >
                      {current.product.imageUrl ? (
                        <s-image
                          src={sizedImageUrl(current.product.imageUrl, 240)}
                          alt={current.product.productTitle}
                          aspectRatio="1/1"
                          objectFit="contain"
                        />
                      ) : (
                        <s-stack alignItems="center" padding="large">
                          <s-icon type="product" tone="neutral" />
                        </s-stack>
                      )}
                    </s-box>
                    <s-stack gap="small-300">
                      <s-heading>{current.product.productTitle}</s-heading>
                      {current.product.variantTitle && (
                        <s-text color="subdued">
                          {current.product.variantTitle}
                        </s-text>
                      )}
                      <s-stack direction="inline" gap="small-200 base">
                        <s-stack
                          direction="inline"
                          gap="small-300"
                          alignItems="center"
                        >
                          <s-icon
                            type="clipboard"
                            tone="neutral"
                            size="small"
                          />
                          <s-text color="subdued">SKU</s-text>
                          <s-text type="strong">
                            {current.product.sku ?? "—"}
                          </s-text>
                        </s-stack>
                        <s-stack
                          direction="inline"
                          gap="small-300"
                          alignItems="center"
                        >
                          <s-icon type="barcode" tone="neutral" size="small" />
                          <s-text color="subdued">EAN</s-text>
                          <s-text type="strong">
                            {current.product.barcode ?? "—"}
                          </s-text>
                        </s-stack>
                      </s-stack>
                    </s-stack>
                  </s-grid>

                  {!current.binCode && (
                    <s-banner tone="warning">
                      No bin has stock of this product in the app. Look for it
                      in the warehouse, or mark it as missing.
                    </s-banner>
                  )}

                  <s-grid
                    gridTemplateColumns="auto 1fr auto"
                    gap="small"
                    alignItems="center"
                  >
                    <s-button
                      icon="arrow-left"
                      disabled={currentIndex <= 0}
                      onClick={() => goToStep(steps[currentIndex - 1].step)}
                    >
                      Previous
                    </s-button>
                    <s-stack direction="inline" justifyContent="center">
                      {inProgress && !current.done && (
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          commandFor={MISSING_MODAL_ID}
                          command="--show"
                        >
                          Mark as missing
                        </s-button>
                      )}
                    </s-stack>
                    <s-button
                      icon="arrow-right"
                      disabled={currentIndex >= steps.length - 1}
                      onClick={() => goToStep(steps[currentIndex + 1].step)}
                    >
                      Next
                    </s-button>
                  </s-grid>
                </s-stack>
              </s-section>

              {/* Scanning */}
              {scanning && (
                <s-section accessibilityLabel="Scan product">
                  <s-stack gap="base">
                    {scanError ? (
                      <s-banner tone="critical" heading="Not picked">
                        {scanError}
                      </s-banner>
                    ) : !focused ? (
                      <s-banner tone="warning" heading="Scanner paused">
                        Click anywhere on this page so it can receive scans.
                      </s-banner>
                    ) : (
                      <s-banner
                        tone="info"
                        heading={`Scan ${current.product.productTitle}`}
                      >
                        Each scan puts one unit into the next box below.
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
                          ref={productField}
                          label="Product barcode"
                          placeholder="Scan or type the product barcode"
                          icon="barcode"
                          autocomplete="off"
                          value={barcode}
                          onInput={(event) =>
                            setBarcode(event.currentTarget.value)
                          }
                        />
                        <s-button type="submit" loading={busy}>
                          Pick
                        </s-button>
                      </s-grid>
                    </form>
                  </s-stack>
                </s-section>
              )}
              {inProgress && current.done && (
                <s-banner tone="success" heading="Done here">
                  Every unit of this step is picked. Moving to the next step…
                </s-banner>
              )}

              {/* One card per box in this step */}
              <s-section heading="Boxes">
                <s-badge slot="accessory">{current.tasks.length}</s-badge>
                <s-stack gap="small">
                  {current.tasks.map((task) => {
                    const complete = task.picked + task.short >= task.quantity;
                    return (
                      <s-box
                        key={task.id}
                        padding="base"
                        borderRadius="large"
                        background={complete ? "subdued" : "base"}
                        border={complete ? "none" : "base"}
                      >
                        <s-grid
                          gridTemplateColumns="@container (inline-size <= 480px) 1fr, 1fr 2fr 1fr"
                          alignItems="center"
                          gap="base"
                        >
                          {/* Order and box; on handhelds the quantity controls
                            sit beside them and the slot spans the card. */}
                          <s-grid
                            gridTemplateColumns="1fr auto"
                            alignItems="center"
                            gap="small"
                          >
                            <s-stack gap="small-400">
                              <s-text color="subdued">{task.orderName}</s-text>
                              <s-stack
                                direction="inline"
                                gap="small-300"
                                alignItems="center"
                              >
                                <s-icon
                                  type="package"
                                  tone="neutral"
                                  size="small"
                                />
                                <s-text color="subdued">{task.boxCode}</s-text>
                              </s-stack>
                            </s-stack>
                            <s-box display="@container (inline-size <= 480px) auto, none">
                              {quantityControls(task, complete)}
                            </s-box>
                          </s-grid>

                          <s-box
                            background={complete ? "base" : "strong"}
                            borderRadius="large"
                            paddingBlock="small"
                            paddingInline="base"
                          >
                            <s-stack alignItems="center" gap="small-500">
                              <s-text color="subdued">Slot</s-text>
                              <DisplayText size="extraLarge">
                                {task.slot}
                              </DisplayText>
                            </s-stack>
                          </s-box>

                          <s-box display="@container (inline-size <= 480px) none, auto">
                            {quantityControls(task, complete)}
                          </s-box>
                        </s-grid>
                      </s-box>
                    );
                  })}
                </s-stack>
              </s-section>

              <s-modal
                id={MISSING_MODAL_ID}
                heading="Mark as missing?"
                size="small"
              >
                <s-paragraph>
                  {`The units of ${current.product.productTitle} still to pick at ${current.binCode ?? "this step"} are recorded as missing and the boxes stay incomplete.`}
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  tone="critical"
                  commandFor={MISSING_MODAL_ID}
                  command="--hide"
                  onClick={() => submit({ intent: "skip" })}
                >
                  Mark as missing
                </s-button>
                <s-button
                  slot="secondary-actions"
                  commandFor={MISSING_MODAL_ID}
                  command="--hide"
                >
                  Keep picking
                </s-button>
              </s-modal>
            </>
          )}
        </s-stack>
      </s-query-container>

      {cancelModal}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
