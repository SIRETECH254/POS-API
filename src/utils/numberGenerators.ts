import Branch from "../models/Branch";
import Shift from "../models/Shift";

/**
 * Generate a unique branch code derived from the branch name.
 * Single word → first 4 chars uppercase (e.g. "Westlands" → "WEST")
 * Multiple words → initials uppercase (e.g. "Main Branch" → "MB")
 * Appends incrementing suffix when a collision is found.
 */
export const generateBranchCode = async (name: string): Promise<string> => {
  const words = name.trim().split(/\s+/);

  let base: string;
  if (words.length === 1) {
    base = (words[0] || "").substring(0, 4).toUpperCase();
  } else {
    base = words.map((w) => (w[0] || "").toUpperCase()).join("");
  }

  let code = base;
  let suffix = 2;

  while (await Branch.exists({ code })) {
    code = `${base}${suffix}`;
    suffix += 1;
  }

  return code;
};

/**
 * Generate a branch-prefixed shift number.
 * Format: {BRANCH_CODE}-SHIFT-{YYYY}-{NNNN}
 * Example: MAIN-SHIFT-2026-0001
 */
export const generateShiftNumber = async (
  branchCode: string | undefined,
  branchId: string
): Promise<string> => {
  const code = branchCode || "BR";
  const year = new Date().getFullYear();
  const count = await Shift.countDocuments({ branch: branchId });
  const sequence = String(count + 1).padStart(4, "0");
  return `${code}-SHIFT-${year}-${sequence}`;
};

/**
 * Generate a branch-prefixed tab number.
 * Format: {BRANCH_CODE}-TAB-{NNNNNN}
 * Stub — implemented when the Tab module is built.
 */
export const generateTabNumber = async (
  branchCode: string | undefined,
  branchId: string
): Promise<string> => {
  const code = branchCode || "BR";
  // Tab model import and count will go here
  void branchId;
  return `${code}-TAB-000001`;
};

/**
 * Generate a branch-prefixed payment number.
 * Format: {BRANCH_CODE}-PAY-{YYYY}-{NNNN}
 * Stub — implemented when the Payment module is built.
 */
export const generatePaymentNumber = async (
  branchCode: string | undefined,
  branchId: string
): Promise<string> => {
  const code = branchCode || "BR";
  const year = new Date().getFullYear();
  void branchId;
  return `${code}-PAY-${year}-0001`;
};

/**
 * Generate a branch-prefixed purchase order number.
 * Format: {BRANCH_CODE}-PO-{YYYY}-{NNNN}
 * Stub — implemented when the Purchase module is built.
 */
export const generatePurchaseNumber = async (
  branchCode: string | undefined,
  branchId: string
): Promise<string> => {
  const code = branchCode || "BR";
  const year = new Date().getFullYear();
  void branchId;
  return `${code}-PO-${year}-0001`;
};
