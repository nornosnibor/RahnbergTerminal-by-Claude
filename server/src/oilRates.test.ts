import { describe, expect, it } from "vitest";
import { dayTrend, downsample, newestPoint, sessionStart, spreadSeries, windowTrend, withLive } from "./oilRates.js";
import { num } from "./providers/cnbc.js";

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;
const DAY = 86_400_000;

describe("sessionStart (6pm New York)", () => {
  it("starts at 6pm the same evening once past it (EDT)", () => {
    expect(sessionStart(at("2026-10-21T04:00:00Z"))).toBe(at("2026-10-20T22:00:00Z")); // midnight EDT
    expect(sessionStart(at("2026-10-20T22:00:00Z"))).toBe(at("2026-10-20T22:00:00Z")); // exactly 6pm
  });

  it("uses the previous evening before 6pm", () => {
    expect(sessionStart(at("2026-10-20T21:59:00Z"))).toBe(at("2026-10-19T22:00:00Z")); // 5:59pm EDT
  });

  it("follows standard time in winter", () => {
    expect(sessionStart(at("2026-12-15T15:00:00Z"))).toBe(at("2026-12-14T23:00:00Z")); // 10am EST
  });

  it("keeps Friday's session over the weekend", () => {
    expect(sessionStart(at("2026-10-23T21:00:00Z"))).toBe(at("2026-10-22T22:00:00Z")); // Fri 5pm EDT close
  });
});

describe("trends", () => {
  const series = (from: number, n: number, step: number, f: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ t: from + i * step, v: f(i) }));

  it("measures today from the previous close and drops bars before the session", () => {
    const pts = series(at("2026-10-20T20:00:00Z"), 12, 30 * MIN, (i) => 100 + i); // 4pm → 9:30pm EDT
    const t = dayTrend(pts, 98, null)!;
    expect(t.points[0].t).toBe(at("2026-10-20T22:00:00Z"));
    expect(t.base).toBe(98);
    expect(t.change).toBe(111 - 98);
  });

  it("falls back to the session's first bar without a previous close", () => {
    const pts = series(at("2026-10-20T22:00:00Z"), 3, MIN, (i) => 5 + i / 100);
    expect(dayTrend(pts, null, null)!.change).toBeCloseTo(0.02);
  });

  it("measures week/month windows from their first point", () => {
    const pts = series(at("2026-09-01T00:00:00Z"), 60, DAY, (i) => i);
    const t = windowTrend(pts, 31 * DAY, null)!;
    expect(t.points[0].v).toBe(28);
    expect(t.change).toBe(59 - 28);
  });

  it("appends the live value only when newer than the last bar", () => {
    const pts = [{ t: 1000, v: 1 }];
    expect(withLive(pts, { t: 2000, v: 2 })).toHaveLength(2);
    expect(withLive(pts, { t: 500, v: 2 })).toHaveLength(1);
    expect(withLive(pts, null)).toBe(pts);
  });

  it("returns null for empty series", () => {
    expect(dayTrend([], 1, null)).toBeNull();
    expect(windowTrend([], DAY, null)).toBeNull();
  });
});

describe("newestPoint", () => {
  const bars = [{ t: 2000, v: 110.6 }];

  it("prefers the intraday bar when the quote is older", () => {
    expect(newestPoint({ last: 110.4, time: 1000 }, [bars])).toEqual({ t: 2000, v: 110.6 });
  });

  it("prefers the quote when it is newer", () => {
    expect(newestPoint({ last: 110.7, time: 3000 }, [bars])).toEqual({ t: 3000, v: 110.7 });
  });

  it("never lets an untimed quote override bars", () => {
    expect(newestPoint({ last: 99.1, time: null }, [null, bars])).toEqual({ t: 2000, v: 110.6 });
  });

  it("uses an untimed quote when there are no bars", () => {
    expect(newestPoint({ last: 99.1, time: null }, [null])?.v).toBe(99.1);
  });
});

describe("helpers", () => {
  it("thins long series to the cap and keeps both ends", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i }));
    const out = downsample(pts, 100);
    expect(out).toHaveLength(100);
    expect(out[0].t).toBe(0);
    expect(out[99].t).toBe(999);
    expect(downsample(pts.slice(0, 50), 100)).toHaveLength(50);
  });

  it("computes a spread on matching buckets only", () => {
    const ten = [{ t: 0, v: 5.1 }, { t: 5 * MIN, v: 5.12 }, { t: 10 * MIN, v: 5.13 }];
    const two = [{ t: 60_000, v: 4.8 }, { t: 10 * MIN, v: 4.79 }];
    expect(spreadSeries(ten, two, 5 * MIN)).toEqual([
      { t: 0, v: 0.3 },
      { t: 10 * MIN, v: 0.34 },
    ]);
  });

  it("parses CNBC display numbers", () => {
    expect(num("110.38")).toBe(110.38);
    expect(num("+1.59")).toBe(1.59);
    expect(num("-0.5")).toBe(-0.5);
    expect(num("5.123%")).toBe(5.123);
    expect(num("9,351")).toBe(9351);
    expect(num("UNCH")).toBeNull();
    expect(num("")).toBeNull();
    expect(num(null)).toBeNull();
  });
});
