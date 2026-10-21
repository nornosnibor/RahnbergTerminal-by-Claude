import { describe, expect, it } from "vitest";
import { direction, fmtChange, fmtLevel, yDomain } from "../oilRates";
import { migrateWorkspace } from "../../store/terminal";

describe("oil & rates formatting", () => {
  it("formats levels per kind", () => {
    expect(fmtLevel("price", 110.528)).toBe("$110.53");
    expect(fmtLevel("yield", 5.1234)).toBe("5.123%");
    expect(fmtLevel("spread", 0.332)).toBe("+33.2bp");
    expect(fmtLevel("spread", -0.05)).toBe("−5.0bp");
    expect(fmtLevel("price", null)).toBe("—");
  });

  it("shows oil changes in dollars and percent, rates in basis points", () => {
    expect(fmtChange("price", 1.74, 108.79)).toBe("+1.74 (+1.60%)");
    expect(fmtChange("price", -2, 100)).toBe("−2.00 (−2.00%)");
    expect(fmtChange("yield", 0.004, 5.117)).toBe("+0.4bp");
    expect(fmtChange("yield", -0.083, 5.2)).toBe("−8.3bp");
    expect(fmtChange("spread", 0, 0.33)).toBe("0.0bp");
  });

  it("treats moves below display precision as flat", () => {
    expect(direction("yield", 0.0002)).toBe("flat");
    expect(direction("yield", 0.001)).toBe("up");
    expect(direction("price", -0.01)).toBe("down");
    expect(direction("price", 0.004)).toBe("flat");
  });

  it("keeps the base line inside the chart range", () => {
    const [lo, hi] = yDomain({ base: 100, change: 5, points: [{ t: 0, v: 102 }, { t: 1, v: 105 }] });
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(105);
    const [flo, fhi] = yDomain({ base: 5, change: 0, points: [{ t: 0, v: 5 }, { t: 1, v: 5 }] });
    expect(fhi).toBeGreaterThan(flo);
  });
});

describe("workspace migration", () => {
  const old = {
    widgets: [
      { id: "w-chart", type: "chart" as const, linked: true },
      { id: "w-news", type: "news" as const, linked: true },
    ],
    layout: [
      { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
      { i: "w-news", x: 0, y: 12, w: 7, h: 7 },
    ],
  };

  it("adds Oil & Rates under the chart and moves later widgets down", () => {
    const out = migrateWorkspace(structuredClone(old), 0);
    expect(out.widgets?.map((w) => w.type)).toEqual(["chart", "news", "oilrates"]);
    expect(out.layout?.find((l) => l.i === "w-oilrates")).toMatchObject({ x: 0, y: 12, w: 12 });
    expect(out.layout?.find((l) => l.i === "w-news")?.y).toBe(24);
    expect(out.layout?.find((l) => l.i === "w-chart")?.y).toBe(0);
  });

  it("does not add it twice or touch current-version workspaces", () => {
    const once = migrateWorkspace(structuredClone(old), 0);
    expect(migrateWorkspace(structuredClone(once), 0).widgets).toHaveLength(3);
    expect(migrateWorkspace(structuredClone(old), 1).widgets).toHaveLength(2);
  });
});
