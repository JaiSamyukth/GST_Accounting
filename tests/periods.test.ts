import { describe, expect, it } from "vitest";
import {
  dueDates, fyLabel, fyStartYear, isIsoDate, periodOf, periodRange, periodsForFy, portalDate, previousPeriod,
} from "@/lib/gst/periods";

describe("periods", () => {
  it("maps dates to monthly and quarterly keys", () => {
    expect(periodOf("2026-11-07", "monthly")).toBe("2026-11");
    expect(periodOf("2026-04-01", "quarterly")).toBe("2026-Q1");
    expect(periodOf("2026-12-31", "quarterly")).toBe("2026-Q3");
    expect(periodOf("2027-02-10", "quarterly")).toBe("2026-Q4");
  });

  it("gives ranges, including Q4 in the next calendar year", () => {
    expect(periodRange("2026-Q4")).toMatchObject({ from: "2027-01-01", to: "2027-03-31", fy: "2026-27", fp: "032027" });
    expect(periodRange("2028-02")).toMatchObject({ from: "2028-02-01", to: "2028-02-29", fp: "022028" });
    expect(periodRange("2027-02").to).toBe("2027-02-28");
  });

  it("handles leap days", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });

  it("lists FY periods and previous periods", () => {
    const months = periodsForFy(2026, "monthly");
    expect(months[0]).toBe("2026-04");
    expect(months[11]).toBe("2027-03");
    expect(previousPeriod("2027-01")).toBe("2026-12");
    expect(previousPeriod("2026-Q1")).toBe("2025-Q4");
    expect(fyStartYear("2027-03-31")).toBe(2026);
    expect(fyLabel(2099)).toBe("2099-00");
  });

  it("computes due dates", () => {
    expect(dueDates("2026-12")).toEqual({ gstr1: "2027-01-11", gstr3b: "2027-01-20" });
    expect(dueDates("2026-Q4")).toEqual({ gstr1: "2027-04-13", gstr3b: "2027-04-22" });
  });

  it("formats portal dates", () => {
    expect(portalDate("2026-11-07")).toBe("07-11-2026");
  });
});
