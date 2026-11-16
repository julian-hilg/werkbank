import { describe, expect, it } from "vitest";
import { SYMBOLS, history } from "../src/market/history";
import { SESSION_MINUTES, aggregate, minuteHistory } from "../src/market/intraday";

describe("minute bars", () => {
  it("agree with the daily bar they were made from", () => {
    for (const symbol of SYMBOLS) {
      const days = history(symbol).slice(-5);
      const minutes = minuteHistory(symbol);
      expect(minutes).toHaveLength(5 * SESSION_MINUTES);
      days.forEach((day, d) => {
        const session = minutes.slice(d * SESSION_MINUTES, (d + 1) * SESSION_MINUTES);
        expect(session[0]!.open).toBe(day.open);
        expect(session.at(-1)!.close).toBe(day.close);
        expect(Math.max(...session.map((b) => b.high))).toBe(day.high);
        expect(Math.min(...session.map((b) => b.low))).toBe(day.low);
        // Rounding each minute's volume can move the total by a few shares.
        expect(Math.abs(session.reduce((s, b) => s + b.volume, 0) - day.volume)).toBeLessThan(SESSION_MINUTES);
      });
    }
  });

  it("are internally consistent and joined end to end within a session", () => {
    const minutes = minuteHistory("DLTA");
    minutes.forEach((bar, i) => {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      const previous = minutes[i - 1];
      if (previous && previous.date === bar.date) expect(bar.open).toBe(previous.close);
    });
  });

  it("aggregate without losing a bar's extremes, volume or day boundary", () => {
    const minutes = minuteHistory("ALFA");
    for (const size of [5, 15, 60]) {
      const merged = aggregate(minutes, size);
      expect(merged.reduce((s, b) => s + b.volume, 0)).toBe(minutes.reduce((s, b) => s + b.volume, 0));
      expect(Math.max(...merged.map((b) => b.high))).toBe(Math.max(...minutes.map((b) => b.high)));
      // 390 minutes from 09:30: buckets aligned to the clock.
      expect(merged.filter((b) => b.date === minutes[0]!.date)).toHaveLength(size === 60 ? 7 : SESSION_MINUTES / size);
      expect(merged[0]!.open).toBe(minutes[0]!.open);
    }
  });
});
