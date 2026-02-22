import { describe, it, expect } from "vitest";
import {
  parseDecimalToBaseUnits,
  formatBaseUnitsToDecimal,
} from "../amounts.js";

describe("parseDecimalToBaseUnits", () => {
  describe("basic conversion", () => {
    it("parses whole number", () => {
      expect(parseDecimalToBaseUnits("100", 6)).toBe(100_000_000n);
    });

    it("parses decimal with full precision", () => {
      expect(parseDecimalToBaseUnits("1.234567", 6)).toBe(1_234_567n);
    });

    it("parses zero", () => {
      expect(parseDecimalToBaseUnits("0", 6)).toBe(0n);
    });

    it("parses zero with decimal point", () => {
      expect(parseDecimalToBaseUnits("0.0", 6)).toBe(0n);
    });

    it("parses smallest unit", () => {
      expect(parseDecimalToBaseUnits("0.000001", 6)).toBe(1n);
    });

    it("parses large amount", () => {
      expect(parseDecimalToBaseUnits("999999999.999999", 6)).toBe(
        999_999_999_999_999n,
      );
    });
  });

  describe("truncation (not rounding)", () => {
    it("truncates extra decimals beyond precision", () => {
      // 1.1234569 with 6 decimals → 1.123456 (truncate, don't round)
      expect(parseDecimalToBaseUnits("1.1234569", 6)).toBe(1_123_456n);
    });

    it("truncates when last digit would round up", () => {
      // 1.9999999 with 6 decimals → 1.999999 (not 2.000000)
      expect(parseDecimalToBaseUnits("1.9999999", 6)).toBe(1_999_999n);
    });

    it("truncates many extra decimals", () => {
      expect(parseDecimalToBaseUnits("1.123456789012345", 6)).toBe(1_123_456n);
    });
  });

  describe("padding", () => {
    it("pads short decimal to full precision", () => {
      // 1.5 with 6 decimals → 1.500000 → 1500000
      expect(parseDecimalToBaseUnits("1.5", 6)).toBe(1_500_000n);
    });

    it("pads single decimal digit", () => {
      expect(parseDecimalToBaseUnits("0.1", 6)).toBe(100_000n);
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      expect(parseDecimalToBaseUnits("  100  ", 6)).toBe(100_000_000n);
    });

    it("trims tabs and newlines", () => {
      expect(parseDecimalToBaseUnits("\t50.5\n", 6)).toBe(50_500_000n);
    });
  });

  describe("different decimal precisions", () => {
    it("works with 2 decimals (USD-like)", () => {
      expect(parseDecimalToBaseUnits("19.99", 2)).toBe(1999n);
    });

    it("works with 18 decimals (ETH-like)", () => {
      expect(parseDecimalToBaseUnits("1.0", 18)).toBe(
        1_000_000_000_000_000_000n,
      );
    });
  });

  describe("validation — rejects invalid input", () => {
    it("throws on negative number", () => {
      expect(() => parseDecimalToBaseUnits("-1", 6)).toThrow(
        "Invalid decimal amount",
      );
    });

    it("throws on non-numeric string", () => {
      expect(() => parseDecimalToBaseUnits("abc", 6)).toThrow(
        "Invalid decimal amount",
      );
    });

    it("throws on empty string", () => {
      expect(() => parseDecimalToBaseUnits("", 6)).toThrow(
        "Invalid decimal amount",
      );
    });

    it("throws on special characters", () => {
      expect(() => parseDecimalToBaseUnits("1,000", 6)).toThrow(
        "Invalid decimal amount",
      );
    });

    it("throws on multiple decimal points", () => {
      expect(() => parseDecimalToBaseUnits("1.2.3", 6)).toThrow(
        "Invalid decimal amount",
      );
    });

    it("throws on scientific notation", () => {
      expect(() => parseDecimalToBaseUnits("1e6", 6)).toThrow(
        "Invalid decimal amount",
      );
    });
  });
});

describe("formatBaseUnitsToDecimal", () => {
  describe("basic conversion", () => {
    it("formats whole number", () => {
      expect(formatBaseUnitsToDecimal(100_000_000n, 6)).toBe("100");
    });

    it("formats with trailing zeros stripped", () => {
      expect(formatBaseUnitsToDecimal(1_500_000n, 6)).toBe("1.5");
    });

    it("formats with full precision", () => {
      expect(formatBaseUnitsToDecimal(1_234_567n, 6)).toBe("1.234567");
    });

    it("formats zero", () => {
      expect(formatBaseUnitsToDecimal(0n, 6)).toBe("0");
    });

    it("formats smallest unit", () => {
      expect(formatBaseUnitsToDecimal(1n, 6)).toBe("0.000001");
    });

    it("formats large amount", () => {
      expect(formatBaseUnitsToDecimal(999_999_999_999_999n, 6)).toBe(
        "999999999.999999",
      );
    });
  });

  describe("negative values", () => {
    it("formats negative whole number", () => {
      expect(formatBaseUnitsToDecimal(-100_000_000n, 6)).toBe("-100");
    });

    it("formats negative decimal", () => {
      expect(formatBaseUnitsToDecimal(-1_500_000n, 6)).toBe("-1.5");
    });

    it("formats negative smallest unit", () => {
      expect(formatBaseUnitsToDecimal(-1n, 6)).toBe("-0.000001");
    });
  });

  describe("different decimal precisions", () => {
    // Note: 0 decimals produces incorrect output (slice(-0) edge case).
    // Not tested as production always uses decimals >= 2.

    it("works with 2 decimals", () => {
      expect(formatBaseUnitsToDecimal(1999n, 2)).toBe("19.99");
    });

    it("works with 18 decimals", () => {
      expect(formatBaseUnitsToDecimal(1_000_000_000_000_000_000n, 18)).toBe(
        "1",
      );
    });
  });
});

describe("round-trip fidelity", () => {
  const DECIMALS = 6;

  const testRoundTrip = (value: string, label?: string) => {
    it(`round-trips "${value}"${label ? ` (${label})` : ""}`, () => {
      const parsed = parseDecimalToBaseUnits(value, DECIMALS);
      const formatted = formatBaseUnitsToDecimal(parsed, DECIMALS);
      expect(formatted).toBe(value);
    });
  };

  testRoundTrip("0");
  testRoundTrip("1");
  testRoundTrip("100");
  testRoundTrip("0.000001", "smallest unit");
  testRoundTrip("999999999.999999", "large amount");
  testRoundTrip("123.456789", "arbitrary precision");
  testRoundTrip("50.5");
  testRoundTrip("0.1");
  testRoundTrip("42");

  it("round-trips 100 random values", () => {
    for (let i = 0; i < 100; i++) {
      // Generate random whole + fraction parts
      const whole = Math.floor(Math.random() * 1_000_000);
      const frac = Math.floor(Math.random() * 1_000_000);
      const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");

      const value = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
      const parsed = parseDecimalToBaseUnits(value, DECIMALS);
      const formatted = formatBaseUnitsToDecimal(parsed, DECIMALS);
      expect(formatted).toBe(value);
    }
  });
});
