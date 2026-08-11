import { Types } from "mongoose";
import { errorHandler } from "../../middleware/errorHandler";
import Product from "../../models/Product";
import StockMovement from "../../models/StockMovement";
import { IStockMovement, StockMovementRefType, StockMovementType } from "../../type";

const INCREASING_TYPES: StockMovementType[] = ["purchased", "returned", "transferred_in"];
const DECREASING_TYPES: StockMovementType[] = ["sold", "damaged", "transferred_out"];

interface RecordStockMovementParams {
  branch: string | Types.ObjectId;
  product: string | Types.ObjectId;
  sku: string | Types.ObjectId;
  type: StockMovementType;
  quantity: number;
  reason?: string;
  reference?: { refType: StockMovementRefType; refId: Types.ObjectId | string };
  performedBy: string | Types.ObjectId;
}

/**
 * Single entry point for all branch-scoped stock changes.
 * Writes the immutable StockMovement ledger entry and atomically updates
 * Product.skus.stockByBranch.currentStock — never mutate currentStock directly elsewhere.
 */
export const recordStockMovement = async (
  params: RecordStockMovementParams
): Promise<IStockMovement> => {
  const { branch, product: productId, sku, type, quantity, reason, reference, performedBy } = params;

  // Load product and locate the SKU subdocument
  const product = await Product.findById(productId);
  if (!product) {
    throw errorHandler(404, "Product not found");
  }

  const skuDoc = product.skus.id(sku as any);
  if (!skuDoc) {
    throw errorHandler(404, "SKU not found");
  }

  // Locate the branch stock entry — must already be initialized
  const branchEntry = (skuDoc.stockByBranch as any[]).find(
    (entry: any) => entry.branch.toString() === branch.toString()
  );
  if (!branchEntry) {
    throw errorHandler(400, "Stock not initialized for this branch/SKU — use setBranchStockLevel first");
  }

  // Determine the signed delta based on movement type
  let signedQuantity: number;
  if (INCREASING_TYPES.includes(type)) {
    signedQuantity = Math.abs(quantity);
  } else if (DECREASING_TYPES.includes(type)) {
    signedQuantity = -Math.abs(quantity);
  } else {
    signedQuantity = quantity;
  }

  const newBalance = branchEntry.currentStock + signedQuantity;

  // Guard — stock cannot go negative
  if (newBalance < 0) {
    throw errorHandler(400, "Insufficient stock for this movement");
  }

  // Apply the new balance and persist
  branchEntry.currentStock = newBalance;
  await product.save();

  // Write the immutable ledger entry
  const movement = await StockMovement.create({
    branch,
    product: productId,
    sku,
    type,
    quantity: signedQuantity,
    balanceAfter: newBalance,
    reference,
    reason,
    performedBy,
  });

  return movement;
};
