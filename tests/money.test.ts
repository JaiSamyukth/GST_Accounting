import { describe, expect, it } from "vitest";
import { amountInWords, formatINR, paise, parseScaled, roundHalfUp, rupeeString } from "@/lib/money";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(roundHalfUp(5n, 2n)).toBe(3);
    expect(roundHalfUp(-5n, 2n)).toBe(-3);
    expect(roundHalfUp(4n, 3n)).toBe(1);
    expect(roundHalfUp(249n, 100n)).toBe(2);
    expect(roundHalfUp(250n, 100n)).toBe(3);
  });

  it("parses rupees into paise", () => {
    expect(paise("1,234.56")).toBe(123456);
    expect(paise("12")).toBe(1200);
    expect(paise("0.005")).toBe(1);
    expect(paise("0.004")).toBe(0);
    expect(paise("-3.25")).toBe(-325);
    expect(paise(19.99)).toBe(1999);
    expect(() => paise("abc")).toThrow();
    expect(() => paise("")).toThrow();
  });

  it("parses scaled decimals", () => {
    expect(parseScaled("2.5", 3)).toBe(2500);
    expect(parseScaled("123.4567", 4)).toBe(1234567);
    expect(parseScaled("1.00005", 4)).toBe(10001);
  });

  it("formats in Indian grouping", () => {
    expect(formatINR(123456)).toBe("1,234.56");
    expect(formatINR(12345678900)).toBe("12,34,56,789.00");
    expect(formatINR(5)).toBe("0.05");
    expect(formatINR(-100000)).toBe("-1,000.00");
    expect(rupeeString(-5)).toBe("-0.05");
  });

  it("writes amounts in words", () => {
    expect(amountInWords(123456)).toBe("Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only");
    expect(amountInWords(1234567800)).toBe("Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
});
