import { describe, expect, it } from "vitest";
import { formatNear, parseNear, YOCTO_PER_NEAR } from "./units.js";

describe("units", () => {
  it("round-trips exactly", () => {
    for (const s of ["0", "1", "2.5", "0.000000000000000000000001", "123456789.123456789012345678901234"]) {
      expect(formatNear(parseNear(s))).toBe(s);
    }
    expect(parseNear("1")).toBe(YOCTO_PER_NEAR);
  });
  it("rejects floats, negatives, exponents and excess precision", () => {
    for (const bad of ["-1", "1e3", "1.", ".5", "abc", "", "0.0000000000000000000000001", "1,5"]) {
      expect(() => parseNear(bad)).toThrow();
    }
  });
});
