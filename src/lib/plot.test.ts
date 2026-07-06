import { describe, it, expect } from "vitest";
import { countByStatus, STATUS_ORDER, type Plot } from "./plot";

const plot = (id: number, status: Plot["status"]): Plot => ({
  id,
  num: String(id),
  polygon: [],
  centroid: { x: 0, y: 0 },
  status,
});

describe("countByStatus", () => {
  it("counts each status and zero-fills missing ones", () => {
    const counts = countByStatus([
      plot(1, "available"),
      plot(2, "available"),
      plot(3, "sold"),
    ]);
    expect(counts.available).toBe(2);
    expect(counts.sold).toBe(1);
    expect(counts.reserved).toBe(0);
    expect(counts.booked).toBe(0);
  });
  it("returns all statuses in STATUS_ORDER", () => {
    const counts = countByStatus([]);
    for (const s of STATUS_ORDER) expect(counts[s]).toBe(0);
  });
});
