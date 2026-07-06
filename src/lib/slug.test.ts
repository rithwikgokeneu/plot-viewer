import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("kebab-cases and strips punctuation", () => {
    expect(slugify("Green Valley — Phase 2!")).toBe("green-valley-phase-2");
  });
  it("falls back to 'project' for empty input", () => {
    expect(slugify("  ***  ")).toBe("project");
  });
});

describe("uniqueSlug", () => {
  it("returns base when free", () => {
    expect(uniqueSlug("green-valley", new Set())).toBe("green-valley");
  });
  it("suffixes with next free integer", () => {
    expect(uniqueSlug("green-valley", new Set(["green-valley", "green-valley-2"]))).toBe(
      "green-valley-3"
    );
  });
});
