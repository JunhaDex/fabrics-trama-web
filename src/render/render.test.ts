import { describe, expect, it } from "vitest";
import { applyOps, type Doc, type Op } from "../model";
import { build, css, toAnnotated, toExport, toSrcdoc } from ".";

function doc(...ops: Op[]): Doc {
  const r = applyOps({ schemaVersion: 1, objects: {} }, { txId: "tx1", actor: "user:test", ops });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.doc;
}

const px = (value: number) => ({ value, unit: "px" });

// 레이아웃 모드 4종과 sizing을 모두 거치는 문서
const pricing = doc(
  { op: "create", id: "frame1", type: "frame", parent: null, position: "last", props: { name: "Pricing & Plans", safeArea: true } },
  { op: "create", id: "head01", type: "section", parent: "frame1", position: "last",
    props: { tag: "header", "layout.mode": "flex-row", "layout.justify": "space-between", "layout.align": "center", "layout.gap": px(16) } },
  { op: "create", id: "logo01", type: "image", parent: "head01", position: "last",
    props: { src: "logo.svg", alt: "trama", "size.width": px(96), "style.object-fit": "contain" } },
  { op: "create", id: "title1", type: "text", parent: "head01", position: "last",
    props: { tag: "h1", content: "요금제 <비교>", "size.width": "fill" } },
  { op: "create", id: "grid01", type: "section", parent: "frame1", position: "last",
    props: { "layout.mode": "grid", "layout.columns": 3, "layout.gap": px(24), "layout.rowGap": px(32), "layout.justify": "center" } },
  { op: "create", id: "card01", type: "container", parent: "grid01", position: "last",
    props: { "grid.colSpan": 2, "size.width": "hug", "size.minHeight": px(120.5) } },
  { op: "create", id: "card02", type: "container", parent: "grid01", position: "last", props: { hidden: true } },
  { op: "create", id: "hero01", type: "container", parent: "frame1", position: "last",
    props: { "layout.mode": "absolute", "layout.clip": true, "size.height": px(240) } },
  { op: "create", id: "badge1", type: "text", parent: "hero01", position: "last",
    props: { tag: "span", content: "NEW", "abs.x": 12, "abs.y": -8, "size.width": "fill" } },
  { op: "create", id: "foot01", type: "section", parent: "frame1", position: "last", props: { tag: "footer" } },
);

describe("golden", () => {
  const page = build(pricing, "frame1");

  it("export", async () => {
    const out = toExport(page);
    await expect(out.html).toMatchFileSnapshot("__golden__/pricing.export.html");
    await expect(out.css).toMatchFileSnapshot("__golden__/pricing.export.css");
  });

  it("srcdoc", async () => {
    await expect(toSrcdoc(page)).toMatchFileSnapshot("__golden__/pricing.srcdoc.html");
  });

  it("annotated", async () => {
    await expect(toAnnotated(page)).toMatchFileSnapshot("__golden__/pricing.annotated.html");
  });
});

describe("결정성", () => {
  it("객체 맵의 키 순서가 달라도 출력이 같다", () => {
    const reversed: Doc = { ...pricing, objects: Object.fromEntries(Object.entries(pricing.objects).reverse()) };
    expect(toSrcdoc(build(reversed, "frame1"))).toBe(toSrcdoc(build(pricing, "frame1")));
  });

  it("속성이 없는 것과 기본값은 같은 출력을 낸다", () => {
    const explicit = doc(
      { op: "create", id: "frame1", type: "frame", parent: null, position: "last",
        props: { "layout.mode": "flex-column", "layout.justify": "start", "layout.align": "stretch", minWidth: 320 } },
      { op: "create", id: "box001", type: "container", parent: "frame1", position: "last",
        props: { "size.width": "fill", "size.height": "hug" } },
    );
    const implicit = doc(
      { op: "create", id: "frame1", type: "frame", parent: null, position: "last" },
      { op: "create", id: "box001", type: "container", parent: "frame1", position: "last" },
    );
    expect(css(build(explicit, "frame1"))).toBe(css(build(implicit, "frame1")));
  });
});
