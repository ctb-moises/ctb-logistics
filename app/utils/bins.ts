// Shared by server code and the UI (field validation).
export const BIN_CODE_MAX_LENGTH = 32;

export function normalizeBinCode(code: string) {
  return code.trim().toUpperCase();
}
