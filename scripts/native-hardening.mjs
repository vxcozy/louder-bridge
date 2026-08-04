export function requireNativeHardening(symbols, label) {
  const detail = String(symbols);
  if (
    !detail.includes("___stack_chk_fail") ||
    !detail.includes("___stack_chk_guard")
  ) {
    throw new Error(`${label} is missing strong stack protection.`);
  }
  if (!/___[A-Za-z0-9_]+_chk\b/.test(detail)) {
    throw new Error(`${label} is missing fortified library calls.`);
  }
}
