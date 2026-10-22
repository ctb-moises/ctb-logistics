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
import { Prisma } from "@prisma/client";
import {
  addToBin,
  BinStockError,
  getInventoryDetail,
  isMovementApplied,
  receiveIntoBin,
  setBinQuantity,
} from "../models/bin-stock.server";
import {
  receiveShopifyStock,
  ShopifyInventoryError,
} from "../services/shopify-inventory.server";
import { BIN_CODE_MAX_LENGTH, normalizeBinCode } from "../utils/bins";
import { sizedImageUrl } from "../utils/images";
import { inventoryItemGid, legacyId } from "../utils/shopify-ids";

const EDIT_MODAL_ID = "edit-quantity-modal";
const BIN_MODAL_ID = "bin-stock-modal";

// The bin modal either assigns existing Shopify stock to a bin ("add-to-bin") or
// receives new units into a bin and into Shopify ("receive").
type BinModalMode = "add-to-bin" | "receive";

type ActionResult =
  | { ok: true; intent: string }
  | { ok: false; intent: string; field: "code" | "quantity"; error: string };

async function loadDetail(request: Request, itemId: string | undefined) {
  const context = await authenticate.admin(request);
  const shop = await getShop(context.session.shop);
  if (!shop?.locationId || !itemId) {
    throw new Response("Not found", { status: 404 });
  }
  const detail = await getInventoryDetail(
    shop.shop,
    shop.locationId,
    inventoryItemGid(itemId),
  );
  if (!detail) throw new Response("Not found", { status: 404 });
  return { context, shop, detail, locationId: shop.locationId };
}

function parseQuantity(value: FormDataEntryValue | null) {
  const quantity = Number(value);
  return value !== null &&
    value !== "" &&
    Number.isInteger(quantity) &&
    quantity >= 0
    ? quantity
    : null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, detail } = await loadDetail(request, params.itemId);
  return { locationName: shop.locationName, ...detail };
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { context, shop, detail, locationId } = await loadDetail(
    request,
    params.itemId,
  );
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const quantity = parseQuantity(formData.get("quantity"));
  const movement = {
    shop: shop.shop,
    locationId,
    userId: context.sessionToken?.sub ?? null,
  };
  const fail = (field: "code" | "quantity", error: string): ActionResult => ({
    ok: false,
    intent,
    field,
    error,
  });

  try {
    if (intent === "set-quantity") {
      if (quantity === null) return fail("quantity", "Enter 0 or more.");
      await setBinQuantity(
        movement,
        Number(formData.get("binStockId")),
        quantity,
      );
    } else if (intent === "add-to-bin" || intent === "receive") {
      const { level } = detail;
      const code = normalizeBinCode(String(formData.get("code") ?? ""));
      if (!code) return fail("code", "Enter a bin.");
      if (code.length > BIN_CODE_MAX_LENGTH) {
        return fail("code", `Use ${BIN_CODE_MAX_LENGTH} characters or fewer.`);
      }
      if (quantity === null || quantity < 1) {
        return fail("quantity", "Enter 1 or more.");
      }

      if (intent === "add-to-bin") {
        if (level.onHand === level.accountedQuantity) {
          return fail("code", "Stock is already consolidated.");
        }
        await addToBin(movement, level, code, quantity);
      } else {
        // Generated when the modal opens, so a retried or double submit is
        // applied once both in Shopify and locally.
        const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
          throw new Response("Bad request", { status: 400 });
        }
        if (!(await isMovementApplied(idempotencyKey))) {
          const onHandAfter = await receiveShopifyStock(context.admin, {
            inventoryItemId: level.inventoryItemId,
            locationId,
            quantity,
            idempotencyKey,
          });
          await receiveIntoBin(
            movement,
            level,
            code,
            quantity,
            idempotencyKey,
            onHandAfter,
          );
        }
      }
    } else {
      throw new Response("Bad request", { status: 400 });
    }
  } catch (error) {
    if (error instanceof BinStockError) return fail(error.field, error.message);
    if (error instanceof ShopifyInventoryError) {
      return fail(
        "quantity",
        `Shopify didn't accept the change: ${error.message}`,
      );
    }
    // A concurrent submit with the same idempotency key already recorded it.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { ok: true, intent };
    }
    throw error;
  }

  return { ok: true, intent };
};

export default function InventoryDetail() {
  const { level, binStock, locationName } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const editModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const binModal = useRef<HTMLElementTagNameMap["s-modal"]>(null);
  const binCodeField = useRef<HTMLElementTagNameMap["s-text-field"]>(null);
  const [editing, setEditing] = useState<{
    id: number;
    code: string;
    quantity: number;
  } | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [binMode, setBinMode] = useState<BinModalMode>("add-to-bin");
  const [newCode, setNewCode] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [receiveKey, setReceiveKey] = useState("");

  // Shopify on-hand vs what the app accounts for: units in bins plus units
  // picked into boxes that wait to be fulfilled.
  const difference = level.onHand - level.accountedQuantity;
  const consolidated = difference === 0;
  const coverage =
    level.onHand > 0
      ? Math.round((level.accountedQuantity / level.onHand) * 100)
      : 0;
  const saving = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const fieldError = (intent: string, field: "code" | "quantity") =>
    result && !result.ok && result.intent === intent && result.field === field
      ? result.error
      : undefined;

  // Live preview of the edit: change in this bin and resulting bin total.
  const editDelta =
    editing && editQuantity !== "" && Number.isInteger(Number(editQuantity))
      ? Number(editQuantity) - editing.quantity
      : 0;
  const binTotalAfterEdit = level.binQuantity + editDelta;
  const accountedAfterEdit = level.accountedQuantity + editDelta;

  useEffect(() => {
    if (!result?.ok) return;
    if (result.intent === "set-quantity") {
      editModal.current?.hideOverlay();
      shopify.toast.show("Quantity updated");
    } else {
      binModal.current?.hideOverlay();
      shopify.toast.show(
        result.intent === "receive" ? "Stock received" : "Added to bin",
      );
    }
  }, [result, shopify]);

  const openEdit = (row: (typeof binStock)[number]) => {
    setEditing({ id: row.id, code: row.bin.code, quantity: row.quantity });
    setEditQuantity(String(row.quantity));
  };

  const openAdd = () => {
    setBinMode("add-to-bin");
    setNewCode("");
    setNewQuantity(String(Math.max(difference, 1)));
  };

  const openReceive = () => {
    setBinMode("receive");
    // Most products live in one bin: suggest it.
    setNewCode(binStock.length === 1 ? binStock[0].bin.code : "");
    setNewQuantity("1");
    setReceiveKey(crypto.randomUUID());
  };

  const receiving = binMode === "receive";

  const statusBadge = (
    <s-badge
      color="base"
      size="large"
      tone={consolidated ? "success" : "critical"}
      icon={consolidated ? "check-circle" : "alert-triangle"}
    >
      {consolidated ? "Consolidated" : "Mismatch"}
    </s-badge>
  );

  return (
    <s-page heading={level.productTitle}>
      <s-link slot="breadcrumb-actions" href="/app/inventory">
        Inventory
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor={BIN_MODAL_ID}
        command="--show"
        onClick={openReceive}
      >
        Receive stock
      </s-button>
      {!consolidated && (
        <s-button
          slot="secondary-actions"
          commandFor={BIN_MODAL_ID}
          command="--show"
          onClick={openAdd}
        >
          Add to bin
        </s-button>
      )}
      {level.productId && level.variantId && (
        <s-button
          slot="secondary-actions"
          icon="external"
          href={`shopify://admin/products/${legacyId(level.productId)}/variants/${legacyId(level.variantId)}`}
          target="_blank"
        >
          View in Shopify
        </s-button>
      )}

      {/* Container queries in these sections need a query container. */}
      <s-query-container>
        <s-stack gap="base">
          {/* Product */}
          <s-section accessibilityLabel="Product">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 500px) 1fr, 160px 1fr"
              gap="large"
              alignItems="center"
            >
              <s-box
                inlineSize="160px"
                blockSize="160px"
                border="base"
                borderRadius="large"
                background="subdued"
                overflow="hidden"
              >
                {level.imageUrl ? (
                  <s-image
                    src={sizedImageUrl(level.imageUrl, 320)}
                    alt={level.productTitle}
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
              <s-stack gap="base">
                <s-stack gap="small-300">
                  <s-heading>{level.productTitle}</s-heading>
                  {level.variantTitle && (
                    <s-text color="subdued">{level.variantTitle}</s-text>
                  )}
                </s-stack>
                <s-stack direction="inline" gap="large">
                  <s-stack
                    direction="inline"
                    gap="small-300"
                    alignItems="center"
                  >
                    <s-icon type="clipboard" tone="neutral" size="small" />
                    <s-text color="subdued">SKU</s-text>
                    <s-text type="strong">{level.sku ?? "—"}</s-text>
                  </s-stack>
                  <s-stack
                    direction="inline"
                    gap="small-300"
                    alignItems="center"
                  >
                    <s-icon type="barcode" tone="neutral" size="small" />
                    <s-text color="subdued">Barcode</s-text>
                    <s-text type="strong">{level.barcode ?? "—"}</s-text>
                  </s-stack>
                </s-stack>
                <s-stack direction="inline">{statusBadge}</s-stack>
              </s-stack>
            </s-grid>
          </s-section>

          {/* Stock: metrics card + coverage */}
          <s-section heading="Stock" accessibilityLabel="Stock">
            <s-stack gap="base">
              <s-grid
                gridTemplateColumns="@container (inline-size <= 480px) 1fr 1fr, 1fr auto 1fr auto 1fr auto 1fr"
                gap="small"
              >
                <s-grid gap="small-300">
                  <s-text color="subdued">Shopify stock</s-text>
                  <s-heading>{level.onHand}</s-heading>
                </s-grid>
                <s-divider direction="block" />
                <s-grid gap="small-300">
                  <s-text color="subdued">In bins</s-text>
                  <s-heading>{level.binQuantity}</s-heading>
                </s-grid>
                <s-divider direction="block" />
                <s-grid gap="small-300">
                  <s-text color="subdued">In boxes</s-text>
                  <s-heading>{level.boxQuantity}</s-heading>
                </s-grid>
                <s-divider direction="block" />
                <s-grid gap="small-300">
                  <s-text color="subdued">
                    {difference >= 0 ? "Unaccounted" : "Over Shopify stock"}
                  </s-text>
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-heading>{Math.abs(difference)}</s-heading>
                    {!consolidated && (
                      <s-badge
                        tone="critical"
                        icon={difference > 0 ? "arrow-down" : "arrow-up"}
                      >
                        {difference > 0 ? "Missing" : "Excess"}
                      </s-badge>
                    )}
                  </s-stack>
                </s-grid>
              </s-grid>
              <s-stack gap="small-300">
                <s-progress
                  value={Math.min(level.accountedQuantity, level.onHand)}
                  max={Math.max(level.onHand, 1)}
                  tone={
                    consolidated
                      ? "success"
                      : difference < 0
                        ? "critical"
                        : "auto"
                  }
                  accessibilityLabel="Stock accounted for in bins and boxes"
                />
                <s-text color="subdued">
                  {difference < 0
                    ? `Bins and boxes hold ${-difference} more units than Shopify stock.`
                    : level.boxQuantity > 0
                      ? `${level.accountedQuantity} of ${level.onHand} units in bins or boxes waiting to ship (${coverage}%).`
                      : `${level.binQuantity} of ${level.onHand} units in bins (${coverage}%).`}
                </s-text>
              </s-stack>
            </s-stack>
          </s-section>

          {/* Bins */}
          <s-section heading="Bins">
            <s-badge slot="accessory">{binStock.length}</s-badge>

            {binStock.length === 0 ? (
              <s-empty-state heading="No bins assigned">
                <s-paragraph slot="subheading">
                  {difference > 0
                    ? `${difference} units in ${locationName} aren't assigned to a bin yet. Add the bins where this product is stored.`
                    : `This product has no stock to put in a bin in ${locationName}.`}
                </s-paragraph>
                {!consolidated && (
                  <s-button
                    slot="primary-action"
                    commandFor={BIN_MODAL_ID}
                    command="--show"
                    onClick={openAdd}
                  >
                    Add to bin
                  </s-button>
                )}
              </s-empty-state>
            ) : (
              <s-grid
                gridTemplateColumns="repeat(auto-fill, minmax(220px, 1fr))"
                gap="base"
              >
                {binStock.map((row) => (
                  <s-box
                    key={row.id}
                    background="strong"
                    borderRadius="large"
                    padding="base"
                  >
                    <s-stack gap="base">
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
                          <s-icon type="location" />
                          <s-heading>{row.bin.code}</s-heading>
                        </s-stack>
                        <s-button
                          variant="tertiary"
                          icon="edit"
                          accessibilityLabel={`Edit quantity in ${row.bin.code}`}
                          commandFor={EDIT_MODAL_ID}
                          command="--show"
                          onClick={() => openEdit(row)}
                        />
                      </s-grid>
                      {row.bin.description && (
                        <s-text color="subdued">{row.bin.description}</s-text>
                      )}
                      <s-stack gap="small-300">
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="baseline"
                        >
                          <s-heading>{row.quantity}</s-heading>
                          <s-text color="subdued">
                            {row.quantity === 1 ? "unit" : "units"}
                          </s-text>
                        </s-stack>
                        <s-progress
                          value={row.quantity}
                          max={Math.max(level.binQuantity, 1)}
                          accessibilityLabel={`Share of bin stock in ${row.bin.code}`}
                        />
                        <s-text color="subdued">
                          {level.binQuantity > 0
                            ? `${Math.round((row.quantity / level.binQuantity) * 100)}% of bin stock`
                            : "Empty"}
                        </s-text>
                      </s-stack>
                    </s-stack>
                  </s-box>
                ))}
                {!consolidated && (
                  <s-clickable
                    border="base base dashed"
                    borderRadius="large"
                    padding="base"
                    commandFor={BIN_MODAL_ID}
                    command="--show"
                    onClick={openAdd}
                    accessibilityLabel="Add to bin"
                  >
                    <s-stack
                      alignItems="center"
                      justifyContent="center"
                      gap="small-300"
                      blockSize="100%"
                    >
                      <s-icon type="plus-circle" />
                      <s-text type="strong">Add to bin</s-text>
                      <s-text color="subdued">
                        {difference > 0
                          ? `${difference} units not in a bin`
                          : "Assign another bin"}
                      </s-text>
                    </s-stack>
                  </s-clickable>
                )}
              </s-grid>
            )}
          </s-section>
        </s-stack>
      </s-query-container>

      <s-modal
        ref={editModal}
        id={EDIT_MODAL_ID}
        heading={`Edit quantity in ${editing?.code ?? ""}`}
        size="small"
      >
        <s-stack gap="base">
          <s-number-field
            label="Quantity"
            min={0}
            step={1}
            value={editQuantity}
            onInput={(event) => setEditQuantity(event.currentTarget.value)}
            error={fieldError("set-quantity", "quantity")}
          />
          {editDelta !== 0 && (
            <s-banner
              tone={accountedAfterEdit === level.onHand ? "success" : "info"}
            >
              {`${editDelta > 0 ? "+" : ""}${editDelta} units. Bin stock will be ${binTotalAfterEdit}`}
              {level.boxQuantity > 0 ? ` (+${level.boxQuantity} in boxes)` : ""}
              {` of ${level.onHand} in Shopify`}
              {accountedAfterEdit === level.onHand ? " — consolidated." : "."}
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={saving}
          onClick={() =>
            editing &&
            fetcher.submit(
              {
                intent: "set-quantity",
                binStockId: editing.id,
                quantity: editQuantity,
              },
              { method: "post" },
            )
          }
        >
          Save
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={EDIT_MODAL_ID}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        ref={binModal}
        id={BIN_MODAL_ID}
        heading={receiving ? "Receive stock" : "Add to bin"}
        size="small"
        onAfterShow={() => binCodeField.current?.focus()}
      >
        <s-stack gap="base">
          <s-text-field
            ref={binCodeField}
            label="Bin"
            placeholder="e.g. A-01-03"
            details={`A new bin is created if it doesn't exist in ${locationName}.`}
            maxLength={BIN_CODE_MAX_LENGTH}
            value={newCode}
            onInput={(event) => setNewCode(event.currentTarget.value)}
            error={fieldError(binMode, "code")}
          />
          <s-number-field
            label="Quantity"
            min={1}
            step={1}
            value={newQuantity}
            details={
              receiving
                ? undefined
                : difference > 0
                  ? `${difference} units aren't in a bin yet.`
                  : undefined
            }
            onInput={(event) => setNewQuantity(event.currentTarget.value)}
            error={fieldError(binMode, "quantity")}
          />
          {receiving && (
            <s-banner tone="info">
              {`Adds the units to the bin and to Shopify stock in ${locationName}${
                Number(newQuantity) > 0
                  ? ` (${level.onHand} → ${level.onHand + Number(newQuantity)})`
                  : ""
              }.`}
            </s-banner>
          )}
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={saving}
          onClick={() =>
            fetcher.submit(
              {
                intent: binMode,
                code: newCode,
                quantity: newQuantity,
                ...(receiving ? { idempotencyKey: receiveKey } : {}),
              },
              { method: "post" },
            )
          }
        >
          {receiving ? "Receive" : "Add"}
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={BIN_MODAL_ID}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
