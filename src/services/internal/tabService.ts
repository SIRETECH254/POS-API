import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Tab from "../../models/Tab";
import Shift from "../../models/Shift";
import Branch from "../../models/Branch";
import { recordStockMovement } from "./stockMovementService";
import { generateTabNumber } from "../../utils/numberGenerators";
import { ITab } from "../../type";

/**
 * Transitions a tab to "completed": deducts stock for every active line item
 * (via the shared stockMovementService ledger) and closes the tab out.
 * Exported for the future Payment module to call once amountPaid >= grandTotal —
 * no route in this codebase invokes it yet, since Payment doesn't exist.
 */
export const completeTab = async (
  tabId: string | Types.ObjectId,
  performedBy: string | Types.ObjectId
): Promise<ITab> => {
  const tab = await Tab.findById(tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  if (tab.status !== "awaiting_payment" && tab.status !== "paid") {
    throw errorHandler(409, "Tab must be awaiting payment or paid before it can be completed");
  }

  if (tab.balanceDue > 0) {
    throw errorHandler(409, "Tab has an outstanding balance due");
  }

  for (const item of tab.items) {
    if (item.status !== "active") {
      continue;
    }

    await recordStockMovement({
      branch: tab.branch as any,
      product: item.product as any,
      sku: item.sku,
      type: "sold",
      quantity: item.quantity,
      reference: { refType: "Tab", refId: tab._id as any },
      performedBy,
    });
  }

  tab.status = "completed";
  tab.closedBy = performedBy as any;
  tab.closedAt = new Date();
  await tab.save();

  await Shift.findByIdAndUpdate(tab.shift, {
    $inc: { "salesSummary.totalSales": tab.grandTotal },
  });

  return tab;
};

/**
 * Merges source tabs into the first tab in tabIds (the target).
 * All tabs must share the same branch and be open/held.
 * Sources are cancelled with a cancelReason pointing at the target tab number.
 */
export const mergeTabs = async (
  tabIds: (string | Types.ObjectId)[],
  performedBy: string | Types.ObjectId
): Promise<ITab> => {
  if (tabIds.length < 2) {
    throw errorHandler(400, "At least two tabs are required to merge");
  }

  const tabs = await Tab.find({ _id: { $in: tabIds } });
  if (tabs.length !== tabIds.length) {
    throw errorHandler(404, "One or more tabs were not found");
  }

  const targetId = tabIds[0]!.toString();
  const target = tabs.find((t) => (t._id as Types.ObjectId).toString() === targetId);
  if (!target) {
    throw errorHandler(404, "Target tab not found");
  }
  const sources = tabs.filter((t) => (t._id as Types.ObjectId).toString() !== targetId);

  for (const tab of tabs) {
    if (tab.branch.toString() !== target.branch.toString()) {
      throw errorHandler(400, "All tabs being merged must belong to the same branch");
    }
    if (tab.status !== "open" && tab.status !== "held") {
      throw errorHandler(409, `Tab ${tab.tabNumber} is not open or held`);
    }
  }

  for (const source of sources) {
    for (const item of source.items) {
      if (item.status !== "active") {
        continue;
      }

      target.items.push({
        product: item.product,
        sku: item.sku,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discount: item.discount,
        subtotal: item.subtotal,
        status: "active",
        addedBy: item.addedBy,
        addedAt: item.addedAt,
      } as any);
    }

    target.mergedFrom.push(source._id as any);
  }

  await target.save();

  for (const source of sources) {
    source.status = "cancelled";
    source.cancelReason = `Merged into ${target.tabNumber}`;
    await source.save();
  }

  void performedBy;
  return target;
};

/**
 * Splits a tab's active items into `groups.length` new tabs.
 * The groups must partition the tab's active item ids exactly — no leftover, no duplicate.
 * The original tab is cancelled with its items marked cancelled and splitInto populated.
 */
export const splitBill = async (
  tabId: string | Types.ObjectId,
  groups: string[][],
  performedBy: string | Types.ObjectId
): Promise<ITab[]> => {
  const tab = await Tab.findById(tabId);
  if (!tab) {
    throw errorHandler(404, "Tab not found");
  }

  if (tab.status !== "open" && tab.status !== "held") {
    throw errorHandler(409, "Tab must be open or held to be split");
  }

  const activeItemIds = tab.items.filter((item) => item.status === "active").map((item) => (item._id as Types.ObjectId).toString());
  const groupedItemIds = groups.flat();

  if (groupedItemIds.length !== activeItemIds.length) {
    throw errorHandler(400, "Split groups must cover every active item on the tab exactly once");
  }

  const groupedSet = new Set(groupedItemIds);
  if (groupedSet.size !== groupedItemIds.length) {
    throw errorHandler(400, "Split groups contain duplicate items");
  }

  for (const id of activeItemIds) {
    if (!groupedSet.has(id)) {
      throw errorHandler(400, "Split groups must cover every active item on the tab exactly once");
    }
  }

  const branchDoc = await Branch.findById(tab.branch);

  const newTabs: ITab[] = [];

  for (const group of groups) {
    const tabNumber = await generateTabNumber(branchDoc?.code, tab.branch.toString());

    const groupItems = group.map((itemId) => {
      const item = tab.items.id(itemId)!;
      return {
        product: item.product,
        sku: item.sku,
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discount: item.discount,
        subtotal: item.subtotal,
        status: "active",
        addedBy: item.addedBy,
        addedAt: item.addedAt,
      };
    });

    const newTab = await Tab.create({
      tabNumber,
      branch: tab.branch,
      table: tab.table,
      openedBy: tab.openedBy,
      shift: tab.shift,
      items: groupItems,
      status: "open",
    });

    newTabs.push(newTab);
  }

  for (const item of tab.items) {
    if (item.status === "active") {
      item.status = "cancelled";
    }
  }
  tab.splitInto = newTabs.map((t) => t._id as any);
  tab.status = "cancelled";
  tab.cancelReason = `Split into ${groups.length} tabs`;
  await tab.save();

  void performedBy;
  return newTabs;
};
