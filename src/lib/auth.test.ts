import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./auth";

describe("auth token", () => {
  it("verifies a token it signed", () => {
    const t = signToken("secret-a");
    expect(verifyToken("secret-a", t)).toBe(true);
  });
  it("rejects a token signed with a different secret", () => {
    const t = signToken("secret-a");
    expect(verifyToken("secret-b", t)).toBe(false);
  });
  it("rejects undefined / empty tokens", () => {
    expect(verifyToken("secret-a", undefined)).toBe(false);
    expect(verifyToken("secret-a", "")).toBe(false);
  });
});
