import { describe, expect, it } from "vitest";
import { checkGstin, gstinCheckChar, isValidPan, stateFromGstin } from "@/lib/gst/gstin";

describe("gstin", () => {
  it("accepts a known valid GSTIN", () => {
    const r = checkGstin("27aapfu0939f1zv");
    expect(r.valid).toBe(true);
    expect(r.stateCode).toBe("27");
    expect(r.pan).toBe("AAPFU0939F");
  });

  it("computes the checksum", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  });

  it("rejects a wrong checksum, bad length, bad state", () => {
    expect(checkGstin("27AAPFU0939F1ZA").errors).toContain("GSTIN checksum does not match");
    expect(checkGstin("27AAPFU0939F1Z").valid).toBe(false);
    const bad = "99AAPFU0939F1Z";
    expect(checkGstin(bad + gstinCheckChar(bad)).valid).toBe(false);
  });

  it("validates PAN and state", () => {
    expect(isValidPan("AAPFU0939F")).toBe(true);
    expect(isValidPan("AAPF0939F")).toBe(false);
    expect(stateFromGstin("33ABCDE1234F1Z5")).toBe("33");
  });
});
