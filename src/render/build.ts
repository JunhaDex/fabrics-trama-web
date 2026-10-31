import { childrenOf, type Doc, type Obj } from "../model";

// 문서 → 중간 트리. 규칙은 docs/architecture/trama-html-conversion.md.

export type Decl = [prop: string, value: string];
export type Rule = { sel: string; decls: Decl[] };
export type El = {
  id: string;
  tag: string;
  attrs: [string, string][];
  layout: string | null;
  text: string | null;
  children: El[];
};
export type Page = { title: string; safeArea: boolean; body: El; rules: Rule[] };

type Dim = { value: number; unit: string };
type Size = "fill" | "hug" | Dim;

const RESET: Rule = {
  sel: "*, ::before, ::after",
  decls: [
    ["box-sizing", "border-box"],
    ["margin", "0"],
    ["padding", "0"],
  ],
};

const DEFAULT_TAG: Record<string, string> = { section: "section", container: "div", text: "p", image: "img" };
const FLEX_ALIGN: Record<string, string> = { start: "flex-start", end: "flex-end" };
const GRID_ALIGN: Record<string, string> = { start: "start", center: "center", end: "end", stretch: "start", baseline: "baseline" };

const num = (n: number) => String(n === 0 ? 0 : n);
const dim = (d: Dim) => num(d.value) + d.unit;
const px = (n: unknown) => `${num((n as number) ?? 0)}px`;
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export function build(doc: Doc, frameId: string): Page {
  const rules: Rule[] = [RESET];
  const visit = (id: string, o: Obj, parent: Obj | null): El => {
    const kids = childrenOf(doc.objects, id);
    const decls = [...(hasLayout(o) ? layoutDecls(o) : []), ...(parent ? childDecls(o, parent) : frameDecls(o))];
    // absolute 노드는 그 자체로 기준 상자가 되므로 relative를 덧붙이지 않는다.
    if (o.position !== "absolute" && kids.some(([, c]) => c.position === "absolute"))
      decls.push(["position", "relative"]);
    for (const [k, v] of Object.entries(o)) if (k.startsWith("style.")) decls.push([k.slice(6), v as string]);
    if (o.hidden) {
      const i = decls.findIndex(([p]) => p === "display");
      if (i >= 0) decls.splice(i, 1);
      decls.push(["display", "none"]);
    }
    if (decls.length) rules.push({ sel: `.n-${id}`, decls: decls.sort(([a], [b]) => (a < b ? -1 : 1)) });
    const attrs: [string, string][] = [["class", `n-${id}`]];
    if (o.type === "image") attrs.push(["src", (o.src as string) ?? ""], ["alt", (o.alt as string) ?? ""]);
    return {
      id,
      tag: parent ? ((o.tag as string) ?? DEFAULT_TAG[o.type]) : "body",
      attrs,
      layout: hasLayout(o) ? mode(o) : null,
      text: o.type === "text" ? ((o.content as string) ?? "") : null,
      children: kids.map(([cid, c]) => visit(cid, c, o)),
    };
  };
  const frame = doc.objects[frameId];
  const body = visit(frameId, frame, null);
  return { title: (frame.name as string) ?? "", safeArea: frame.safeArea === true, body, rules };
}

const hasLayout = (o: Obj) => o.type === "frame" || o.type === "section" || o.type === "container";
const mode = (o: Obj) => (o["layout.mode"] as string) ?? "flex-column";

function layoutDecls(o: Obj): Decl[] {
  const m = mode(o);
  const d: Decl[] = [];
  if (o["layout.clip"]) d.push(["overflow", "hidden"]);
  const gap = o["layout.gap"] as Dim | undefined;
  const rowGap = (o["layout.rowGap"] as Dim | undefined) ?? gap;
  if (gap) d.push(["column-gap", dim(gap)]);
  if (rowGap) d.push(["row-gap", dim(rowGap)]);
  if (m === "grid") {
    d.push(["display", "grid"], ["grid-template-columns", `repeat(${o["layout.columns"] ?? 1}, minmax(0, 1fr))`]);
    return d;
  }
  d.push(["display", "flex"], ["flex-direction", m === "flex-row" ? "row" : "column"]);
  const j = (o["layout.justify"] as string) ?? "start";
  const a = (o["layout.align"] as string) ?? "stretch";
  if (j !== "start") d.push(["justify-content", FLEX_ALIGN[j] ?? j]);
  if (a !== "stretch") d.push(["align-items", FLEX_ALIGN[a] ?? a]);
  if (o["layout.wrap"]) d.push(["flex-wrap", "wrap"]);
  return d;
}

function frameDecls(o: Obj): Decl[] {
  const d: Decl[] = [["min-width", px(o.minWidth ?? 320)]];
  if (o.safeArea) for (const s of ["top", "right", "bottom", "left"]) d.push([`padding-${s}`, `env(safe-area-inset-${s})`]);
  return d;
}

function childDecls(o: Obj, parent: Obj): Decl[] {
  if (o.position === "absolute") {
    const d: Decl[] = [["position", "absolute"], ["left", px(o.x)], ["top", px(o.y)]];
    if (o.w !== undefined) d.push(["width", px(o.w)]);
    if (o.h !== undefined) d.push(["height", px(o.h)]);
    return d;
  }
  const m = mode(parent);
  const d: Decl[] = [];
  for (const k of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
    const v = o[`size.${k}`] as Dim | undefined;
    if (v) d.push([kebab(k), dim(v)]);
  }
  const w = o["size.width"] as Size | undefined;
  const h = o["size.height"] as Size | undefined;

  if (m === "grid") {
    for (const [axis, start, span] of [["column", "grid.colStart", "grid.colSpan"], ["row", "grid.rowStart", "grid.rowSpan"]]) {
      if (o[start]) d.push([`grid-${axis}-start`, String(o[start])]);
      if (o[span]) d.push([`grid-${axis}-end`, `span ${o[span]}`]);
    }
    const self = (s: Size | undefined, prop: string, selfProp: string, parentKey: string, def: string) => {
      if (!s || s === "fill") return;
      d.push([selfProp, GRID_ALIGN[(parent[parentKey] as string) ?? def] ?? "start"]);
      if (s !== "hug") d.push([prop, dim(s)]);
    };
    self(w, "width", "justify-self", "layout.justify", "start");
    self(h, "height", "align-self", "layout.align", "stretch");
    return d;
  }

  const row = m === "flex-row";
  const [mainProp, crossProp] = row ? ["width", "height"] : ["height", "width"];
  const main = (row ? w : h) ?? "hug";
  const cross = (row ? h : w) ?? "fill";
  if (main === "fill") {
    d.push(["flex-grow", "1"], ["flex-basis", "0%"]);
    if (!o[`size.min${row ? "Width" : "Height"}`]) d.push([`min-${mainProp}`, "0"]);
  } else if (main !== "hug") d.push([mainProp, dim(main)], ["flex-shrink", "0"]);
  const stretch = ((parent["layout.align"] as string) ?? "stretch") === "stretch";
  if (cross === "fill" && !stretch) d.push(["align-self", "stretch"]);
  else if (cross === "hug" && stretch) d.push(["align-self", "flex-start"]);
  else if (cross !== "fill" && cross !== "hug") d.push([crossProp, dim(cross)]);
  return d;
}
