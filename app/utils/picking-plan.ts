// Builds the picking route of a round (pure, no I/O).
//
// Each step is one product in one bin; steps follow the route, bins in
// alphabetical order. A product's units come from its bins in route order: when
// a bin doesn't hold enough, the rest goes to the product's next bin. Units no
// bin holds end up in a final "no bin" step. Within a product, orders are served
// in cart slot order.

export type PlanLine = {
  lineId: number;
  inventoryItemId: string;
  productTitle: string;
  slot: number;
  quantity: number;
};

export type PlanBinStock = {
  inventoryItemId: string;
  binId: number;
  binCode: string;
  quantity: number;
};

export type PlanTask = {
  lineId: number;
  binId: number | null;
  binCode: string | null;
  quantity: number;
  step: number;
};

export const compareBinCodes = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

export function buildPickingPlan(
  lines: PlanLine[],
  binStock: PlanBinStock[],
): PlanTask[] {
  const binsByItem = groupBy(
    binStock.filter((stock) => stock.quantity > 0),
    (stock) => stock.inventoryItemId,
  );
  const tasks: (Omit<PlanTask, "step"> & {
    productTitle: string;
    inventoryItemId: string;
  })[] = [];

  for (const [inventoryItemId, itemLines] of groupBy(
    lines,
    (l) => l.inventoryItemId,
  )) {
    const queue = [...itemLines]
      .sort((a, b) => a.slot - b.slot)
      .map((line) => ({ line, remaining: line.quantity }));
    const bins = [...(binsByItem.get(inventoryItemId) ?? [])].sort((a, b) =>
      compareBinCodes(a.binCode, b.binCode),
    );

    const take = (
      binId: number | null,
      binCode: string | null,
      capacity: number,
    ) => {
      for (const entry of queue) {
        if (capacity === 0) break;
        const quantity = Math.min(entry.remaining, capacity);
        if (quantity === 0) continue;
        entry.remaining -= quantity;
        capacity -= quantity;
        tasks.push({
          lineId: entry.line.lineId,
          binId,
          binCode,
          quantity,
          productTitle: entry.line.productTitle,
          inventoryItemId,
        });
      }
    };

    for (const bin of bins) take(bin.binId, bin.binCode, bin.quantity);
    take(null, null, Infinity);
  }

  // Number the steps along the route: bins alphabetically ("no bin" last), then
  // product title.
  const stepKey = (task: (typeof tasks)[number]) =>
    `${task.binCode ?? ""}|${task.inventoryItemId}`;
  const steps = [...groupBy(tasks, stepKey).values()].sort((a, b) => {
    const [x, y] = [a[0], b[0]];
    if (x.binCode === null || y.binCode === null) {
      if (x.binCode !== y.binCode) return x.binCode === null ? 1 : -1;
    } else {
      const byBin = compareBinCodes(x.binCode, y.binCode);
      if (byBin !== 0) return byBin;
    }
    return x.productTitle.localeCompare(y.productTitle);
  });

  return steps.flatMap((stepTasks, index) =>
    stepTasks.map(({ lineId, binId, binCode, quantity }) => ({
      lineId,
      binId,
      binCode,
      quantity,
      step: index + 1,
    })),
  );
}
