import { describe, expect, it } from "vitest";
import { toDateTimeCL } from "@/lib/format";

describe("toDateTimeCL", () => {
  it("usa la hora de Chile aunque el servidor corra en UTC", () => {
    // 00:30 UTC del 22-09 = 21:30 del 21-09 en Santiago (UTC-3 en septiembre).
    const s = toDateTimeCL("2026-09-22T00:30:00Z");
    expect(s).toContain("21-09-2026");
    expect(s).toMatch(/21:30/);
  });
});
