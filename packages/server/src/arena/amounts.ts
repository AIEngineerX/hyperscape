export function parseDecimalToBaseUnits(
  value: string,
  decimals: number,
): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [wholePart, fracPartRaw = ""] = normalized.split(".");
  const fracPart = fracPartRaw.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(`${wholePart}${fracPart}`.replace(/^0+(?=\d)/, "") || "0");
}

export function formatBaseUnitsToDecimal(
  value: bigint,
  decimals: number,
): string {
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  const text = absValue.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  const rendered = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${rendered}` : rendered;
}
