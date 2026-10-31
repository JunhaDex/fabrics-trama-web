import { describe, expect, it } from "vitest";
import { applyOps, type Doc, type Op } from "../model";
import { build, css, toAnnotated, toExport, toSnippet, toSrcdoc } from ".";

function doc(...ops: Op[]): Doc {
  const r = applyOps({ schemaVersion: 1, objects: {} }, { txId: "tx1", actor: "user:test", ops });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.doc;
}

const px = (value: number) => ({ value, unit: "px" });
const rgb = (r: number, g: number, b: number, alpha?: number) => ({
  colorSpace: "srgb",
  components: [r, g, b],
  ...(alpha !== undefined && { alpha }),
});

const pricing = doc(
  { op: "create", id: "frame1", type: "frame", parent: null, placement: "last", props: { name: "Pricing & Plans", safeArea: true, "style.background-color": rgb(1, 1, 1), "style.color": rgb(0.1, 0.1, 0.1) } },
  { op: "create", id: "head01", type: "section", parent: "frame1", placement: "last",
    props: { tag: "header", "layout.mode": "flex-row", "layout.justify": "space-between", "layout.align": "center", "layout.gap": px(16) } },
  { op: "create", id: "logo01", type: "image", parent: "head01", placement: "last",
    props: { src: "logo.svg", alt: "trama", "size.width": px(96), "style.object-fit": "contain" } },
  { op: "create", id: "title1", type: "text", parent: "head01", placement: "last",
    props: { tag: "h1", content: "요금제 <비교>", "size.width": "fill", "style.font-size": { value: 1.5, unit: "rem" }, "style.font-weight": 700 } },
  { op: "create", id: "grid01", type: "section", parent: "frame1", placement: "last",
    props: { "layout.mode": "grid", "layout.columns": 3, "layout.gap": px(24), "layout.rowGap": px(32), "layout.justify": "center" } },
  { op: "create", id: "card01", type: "container", parent: "grid01", placement: "last",
    props: { "grid.colSpan": 2, "size.width": "hug", "size.minHeight": px(120.5),
      "style.padding-top": px(16), "style.padding-left": px(16), "style.border-width": px(1), "style.border-style": "solid",
      "style.border-color": rgb(0, 0, 0, 0.12), "style.border-radius": px(8), "style.background-color": rgb(0.2, 0.4, 1) } },
  { op: "create", id: "card02", type: "container", parent: "grid01", placement: "last", props: { hidden: true } },
  { op: "create", id: "hero01", type: "container", parent: "frame1", placement: "last",
    props: { "layout.clip": true, "size.height": px(240) } },
  { op: "create", id: "lead01", type: "text", parent: "hero01", placement: "last", props: { content: "흐름 안의 자식" } },
  { op: "create", id: "badge1", type: "container", parent: "hero01", placement: "last",
    props: { position: "absolute", x: 12, y: -8, w: 64.5, h: 24, "size.width": "fill" } },
  { op: "create", id: "dot001", type: "container", parent: "badge1", placement: "last",
    props: { position: "absolute", x: 0, y: 0, w: 8, h: 8 } },
  { op: "create", id: "foot01", type: "section", parent: "frame1", placement: "last", props: { tag: "footer" } },
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
      { op: "create", id: "frame1", type: "frame", parent: null, placement: "last",
        props: { "layout.mode": "flex-column", "layout.justify": "start", "layout.align": "stretch", minWidth: 320 } },
      { op: "create", id: "box001", type: "container", parent: "frame1", placement: "last",
        props: { "size.width": "fill", "size.height": "hug" } },
    );
    const implicit = doc(
      { op: "create", id: "frame1", type: "frame", parent: null, placement: "last" },
      { op: "create", id: "box001", type: "container", parent: "frame1", placement: "last" },
    );
    expect(css(build(explicit, "frame1"))).toBe(css(build(implicit, "frame1")));
  });
});

describe("반응형 golden", () => {
  const rem = (value: number) => ({ value, unit: "rem" });
  const resp = doc(
    { op: "create", id: "frame1", type: "frame", parent: null, placement: "last", props: { name: "Responsive" } },
    { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { name: "Tablet", minWidth: 768 } },
    { op: "create", id: "bp1280", type: "breakpoint", parent: "frame1", props: { name: "Desktop", minWidth: 1280 } },
    { op: "create", id: "row001", type: "section", parent: "frame1", placement: "last",
      props: { "layout.mode@bp:bp0768": "flex-row", "layout.gap": px(8), "layout.gap@bp:bp1280": px(24) } },
    { op: "create", id: "side01", type: "container", parent: "row001", placement: "last", props: { "size.width@bp:bp0768": px(240) } },
    { op: "create", id: "main01", type: "container", parent: "row001", placement: "last", props: { "size.width@bp:bp0768": "fill" } },
    { op: "create", id: "head01", type: "text", parent: "main01", placement: "last",
      props: { content: "제목", "style.font-size": rem(1.25), "style.font-size@bp:bp1280": rem(2) } },
    { op: "create", id: "note01", type: "text", parent: "main01", placement: "last",
      props: { content: "데스크톱 전용", hidden: true, "hidden@bp:bp1280": false } },
    { op: "create", id: "tabl01", type: "text", parent: "main01", placement: "last",
      props: { content: "태블릿 전용", "hidden@bp:bp0768": true } },
    { op: "create", id: "hero01", type: "image", parent: "main01", placement: "last",
      props: { src: "s.jpg", alt: "히어로", "src@bp:bp0768": "m.jpg", "src@bp:bp1280": "l.jpg" } },
  );
  const page = build(resp, "frame1");

  it("export", async () => {
    const out = toExport(page);
    await expect(out.html).toMatchFileSnapshot("__golden__/responsive.export.html");
    await expect(out.css).toMatchFileSnapshot("__golden__/responsive.export.css");
  });

  it("srcdoc", async () => {
    await expect(toSrcdoc(page)).toMatchFileSnapshot("__golden__/responsive.srcdoc.html");
  });

  it("BP가 없으면 @media를 내지 않는다", () => {
    expect(css(build(pricing, "frame1"))).not.toContain("@media");
  });
});

describe("snippet", () => {
  const resp = build(
    doc(
      { op: "create", id: "frame1", type: "frame", parent: null, placement: "last" },
      { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
      { op: "create", id: "side01", type: "container", parent: "frame1", placement: "last", props: { "style.padding-top": px(8) } },
      { op: "create", id: "main01", type: "container", parent: "frame1", placement: "last", props: { "layout.gap": px(4), "layout.gap@bp:bp0768": px(16) } },
      { op: "create", id: "head01", type: "text", parent: "main01", placement: "last", props: { content: "제목", "hidden@bp:bp0768": true } },
      { op: "create", id: "hero01", type: "image", parent: "main01", placement: "last", props: { src: "s.jpg", "src@bp:bp0768": "m.jpg" } },
    ),
    "frame1",
  );

  it("선택한 노드와 하위 노드만 담는다", async () => {
    const s = toSnippet(resp, "main01")!;
    await expect(s.html + "\n" + s.css).toMatchFileSnapshot("__golden__/snippet.main01.txt");
    expect(s.css).not.toContain("n-side01");
    expect(s.css).not.toContain("box-sizing");
  });

  it("picture 안의 img를 고르면 picture째 담는다", () => {
    expect(toSnippet(resp, "hero01")!.html).toMatch(/^<picture>/);
  });

  it("없는 ID는 null이다", () => {
    expect(toSnippet(resp, "nobody")).toBeNull();
  });
});

describe("토큰 golden", () => {
  const tok = (id: string, props: object) => ({ op: "create", id, type: "token", parent: null, props }) as Op;
  const tokens = doc(
    { op: "create", id: "palette", type: "modifier", parent: null, props: { name: "palette", contexts: ["brand", "mono"], default: "brand" } },
    tok("tkBlue1", { name: "color.blue", tokenType: "color", value: rgb(0.2, 0.4, 1), variesBy: "palette", "value@ctx:mono": rgb(0.5, 0.5, 0.5) }),
    tok("tkPrim1", { name: "color.primary", tokenType: "color", value: { ref: "tkBlue1" }, variesBy: "_mode", "value@ctx:dark": rgb(1, 1, 1) }),
    tok("tkSurf1", { name: "color.surface", tokenType: "color", value: rgb(1, 1, 1), variesBy: "_mode", "value@ctx:dark": rgb(0.1, 0.1, 0.1) }),
    tok("tkSpace", { name: "space.md", tokenType: "dimension", value: px(16) }),
    tok("tkFont1", { name: "font.body", tokenType: "fontFamily", value: ["Noto Sans KR", "sans-serif"] }),
    tok("tkUnusd", { name: "unused", tokenType: "number", value: 1 }),
    { op: "create", id: "frame1", type: "frame", parent: null, placement: "last",
      props: { "style.background-color": { token: "tkSurf1" }, "style.font-family": { token: "tkFont1" } } },
    { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
    { op: "create", id: "card01", type: "container", parent: "frame1", placement: "last",
      props: { "style.background-color": { token: "tkPrim1" }, "style.padding-top": { token: "tkSpace" }, "layout.gap@bp:bp0768": { token: "tkSpace" } } },
  );

  it("export css", async () => {
    await expect(toExport(build(tokens, "frame1")).css).toMatchFileSnapshot("__golden__/tokens.export.css");
  });
});
