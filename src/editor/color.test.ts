import { describe, expect, it } from "vitest";
import { hex, ramp, toColor, toOklch } from "./color";

describe("color", () => {
  it("hex와 Color를 오간다", () => {
    expect(hex(toColor("#3366ff"))).toBe("#3366ff");
  });

  it("OKLCH 변환은 알려진 값과 일치한다", () => {
    const [L, C] = toOklch([1, 1, 1]);
    expect(L).toBeCloseTo(1, 3);
    expect(C).toBeCloseTo(0, 3);
  });

  it("램프는 밝은 단계에서 어두운 단계로 명도가 단조 감소한다", () => {
    const colors = ramp(toColor("#3366ff"), [50, 100, 300, 500, 700, 900]);
    const Ls = colors.map((c) => toOklch(c.components)[0]);
    for (let i = 1; i < Ls.length; i++) expect(Ls[i]).toBeLessThan(Ls[i - 1]);
    for (const c of colors) for (const v of c.components) expect(v >= 0 && v <= 1).toBe(true);
  });
});
