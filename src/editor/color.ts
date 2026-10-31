export type Color = { colorSpace: "srgb"; components: [number, number, number]; alpha?: number };

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export const hex = (c: Color) => "#" + c.components.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

export const toColor = (h: string): Color => ({
  colorSpace: "srgb",
  components: [1, 3, 5].map((i) => r4(parseInt(h.slice(i, i + 2), 16) / 255)) as Color["components"],
});

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB(0~1) → OKLCH [L, C, h(라디안)]. */
export function toOklch([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function fromOklch(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = (c: number[]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/**
 * 기준색의 색상(hue)을 유지하며 OKLCH 명도를 단계별로 바꾼 색 목록을 만든다.
 * 단계는 50(가장 밝음)~900(가장 어두움)이고, sRGB 범위를 벗어나면 채도를 줄여 맞춘다.
 */
export function ramp(base: Color, steps: number[]): Color[] {
  const [, C, h] = toOklch(base.components);
  return steps.map((step) => {
    const L = 0.97 - ((step - 50) / 850) * (0.97 - 0.3);
    let lo = 0;
    let hi = C;
    while (hi - lo > 1e-4) {
      const mid = (lo + hi) / 2;
      if (inGamut(fromOklch(L, mid, h))) lo = mid;
      else hi = mid;
    }
    const rgb = fromOklch(L, lo, h).map((v) => r4(Math.min(1, Math.max(0, v))));
    return { colorSpace: "srgb", components: rgb as Color["components"] };
  });
}
