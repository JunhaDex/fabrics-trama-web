import { breakpointsOf, childrenOf, type Doc, type Obj } from "../model";

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
export type Media = { min: number; rules: Rule[] };
export type Page = { title: string; safeArea: boolean; body: El; rules: Rule[]; media: Media[] };

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

type Color = { components: [number, number, number]; alpha?: number };

function color({ components, alpha = 1 }: Color) {
  const [r, g, b] = components.map((c) => Math.round(c * 255));
  if (alpha === 1) return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
  return `rgb(${r} ${g} ${b} / ${num(alpha)})`;
}

function value(v: unknown): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return v;
  return "unit" in (v as object) ? dim(v as Dim) : color(v as Color);
}
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export function build(doc: Doc, frameId: string): Page {
  const bps = breakpointsOf(doc.objects, frameId).map(([id, o]) => ({ id, min: o.minWidth as number }));
  const order: string[] = [];
  const cache = new Map<string, Obj>();

  // state -1은 base, i는 bps[0..i]의 override까지 적용한 상태다.
  const at = (id: string, state: number): Obj => {
    const key = `${id}|${state}`;
    let o = cache.get(key);
    if (!o) {
      const src = doc.objects[id];
      o = Object.fromEntries(Object.entries(src).filter(([k]) => !k.includes("@"))) as Obj;
      for (let i = 0; i <= state; i++)
        for (const [k, v] of Object.entries(src)) if (k.endsWith(`@bp:${bps[i].id}`)) o[k.slice(0, k.indexOf("@"))] = v;
      cache.set(key, o);
    }
    return o;
  };

  const declsAt = (id: string, state: number): Map<string, string> => {
    const o = at(id, state);
    const parent = o.parent === null ? null : at(o.parent, state);
    const kids = childrenOf(doc.objects, id);
    const d = [...(hasLayout(o) ? layoutDecls(o) : []), ...(parent ? childDecls(o, parent) : frameDecls(o))];
    // absolute 노드는 그 자체로 기준 상자가 되므로 relative를 덧붙이지 않는다.
    if (o.position !== "absolute" && kids.some(([cid]) => at(cid, state).position === "absolute")) d.push(["position", "relative"]);
    for (const [k, v] of Object.entries(o)) if (k.startsWith("style.")) d.push([k.slice(6), value(v)]);
    const m = new Map(d);
    if (o.hidden) m.set("display", "none");
    return m;
  };

  const visit = (id: string, o: Obj, isBody: boolean): El => {
    order.push(id);
    const kids = childrenOf(doc.objects, id);
    const attrs: [string, string][] = [["class", `n-${id}`]];
    if (o.type === "image") attrs.push(["src", (o.src as string) ?? ""], ["alt", (o.alt as string) ?? ""]);
    const el: El = {
      id,
      tag: isBody ? "body" : ((o.tag as string) ?? DEFAULT_TAG[o.type]),
      attrs,
      layout: hasLayout(o) ? mode(o) : null,
      text: o.type === "text" ? ((o.content as string) ?? "") : null,
      children: kids.map(([cid, c]) => visit(cid, c, false)),
    };
    const sources = [...bps].reverse().flatMap(({ id: bp, min }) => {
      const src = o[`src@bp:${bp}`];
      return src === undefined ? [] : [wrap("source", [["media", `(min-width: ${min}px)`], ["srcset", src as string]])];
    });
    return sources.length ? wrap("picture", [], [...sources, el]) : el;
  };

  const frame = doc.objects[frameId];
  const body = visit(frameId, frame, true);
  const sorted = (m: Map<string, string>): Decl[] => [...m].sort(([a], [b]) => (a < b ? -1 : 1));
  const rules: Rule[] = [RESET];
  if (Object.values(doc.objects).some((o) => Object.keys(o).some((k) => k.startsWith("src@bp:"))))
    rules.push({ sel: "picture", decls: [["display", "contents"]] });
  for (const id of order) {
    const d = declsAt(id, -1);
    if (d.size) rules.push({ sel: `.n-${id}`, decls: sorted(d) });
  }
  const media = bps.flatMap(({ min }, i): Media[] => {
    const changed: Rule[] = [];
    for (const id of order) {
      const prev = declsAt(id, i - 1);
      const next = declsAt(id, i);
      const d = new Map([...next].filter(([p, v]) => prev.get(p) !== v));
      for (const p of prev.keys()) if (!next.has(p)) d.set(p, "revert");
      if (d.size) changed.push({ sel: `.n-${id}`, decls: sorted(d) });
    }
    return changed.length ? [{ min, rules: changed }] : [];
  });
  return { title: (frame.name as string) ?? "", safeArea: frame.safeArea === true, body, rules, media };
}

const wrap = (tag: string, attrs: [string, string][], children: El[] = []): El => ({
  id: "",
  tag,
  attrs,
  layout: null,
  text: null,
  children,
});

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
