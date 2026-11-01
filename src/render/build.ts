import {
  breakpointsOf,
  childrenOf,
  componentPropsOf,
  modifiersOf,
  optionsOf,
  overrideTarget,
  STATES,
  tokenValueAt,
  type Doc,
  type Obj,
  type Objects,
} from "../model";

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
/** `@media …` 또는 `@container …` 블록. at은 블록 머리(`@media (min-width: 768px)`)다. */
export type Media = { at: string; rules: Rule[] };
/** 컴포넌트 보드 미리보기용 옵션. 루트에 속성 값과 `data-trama-state`를 붙이고, 상태 선택자가 그 속성에도 반응한다. */
export type BuildOpts = { preview?: { props: Record<string, string>; state: string | null } };
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

// 토큰 바인딩은 상태 계산 단계에서 { css: "var(--…)" }로 바뀐다. 아래 형식 함수는 이 값을 그대로 낸다.
type Css = { css: string };
const isCss = (v: unknown): v is Css => typeof v === "object" && v !== null && "css" in v;

const num = (n: number) => String(n === 0 ? 0 : n);
const dim = (d: Dim | Css) => (isCss(d) ? d.css : num(d.value) + d.unit);
const px = (n: unknown) => `${num((n as number) ?? 0)}px`;

type Color = { components: [number, number, number]; alpha?: number };

function color({ components, alpha = 1 }: Color) {
  const [r, g, b] = components.map((c) => Math.round(c * 255));
  if (alpha === 1) return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
  return `rgb(${r} ${g} ${b} / ${num(alpha)})`;
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"]);

function value(v: unknown): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return v;
  if (isCss(v)) return v.css;
  return "unit" in (v as object) ? dim(v as Dim) : color(v as Color);
}

const cssVar = (name: string) => `--${name.replace(/\./g, "-")}`;

function tokenCss(objects: Objects, v: unknown): string {
  if (typeof v === "object" && v !== null && "ref" in v) return `var(${cssVar(objects[(v as { ref: string }).ref].name as string)})`;
  const families = Array.isArray(v) ? v : null;
  if (families || (typeof v === "string" && Number.isNaN(Number(v))))
    return (families ?? [v as string]).map((f) => (GENERIC.has(f) ? f : `"${f.replace(/"/g, '\\"')}"`)).join(", ");
  return value(v);
}

/** Frame에서 쓰는 토큰과 그 토큰이 참조하는 토큰의 CSS 사용자 정의 속성 규칙. */
function tokenRules(objects: Objects, ids: string[]): { rules: Rule[]; media: Media[] } {
  const used = new Set<string>();
  const add = (id: string) => {
    if (used.has(id)) return;
    used.add(id);
    for (const [k, v] of Object.entries(objects[id])) if ((k === "value" || k.startsWith("value@ctx:")) && v && typeof v === "object" && "ref" in v) add((v as { ref: string }).ref);
  };
  for (const id of ids)
    for (const v of Object.values(objects[id])) if (v && typeof v === "object" && "token" in v) add((v as { token: string }).token);
  if (!used.size) return { rules: [], media: [] };
  const tokens = [...used].sort((a, b) => ((objects[a].name as string) < (objects[b].name as string) ? -1 : 1));
  const mods = modifiersOf(objects);
  const defaults = Object.fromEntries(mods.map(([mid, m]) => [mid, m.default as string]));
  const decl = (id: string, combo: Record<string, string>): Decl => [cssVar(objects[id].name as string), tokenCss(objects, tokenValueAt(objects[id], combo))];
  const root = new Map(tokens.map((id) => decl(id, defaults)));
  const rules: Rule[] = [{ sel: ":root", decls: [...root] }];
  const media: Media[] = [];
  for (const [mid, m] of mods)
    for (const ctx of m.contexts as string[]) {
      if (ctx === m.default) continue;
      const decls = tokens
        .filter((id) => objects[id].variesBy === mid)
        .map((id) => decl(id, { ...defaults, [mid]: ctx }))
        .filter(([p, v]) => root.get(p) !== v);
      if (!decls.length) continue;
      rules.push({ sel: `:root[data-${m.name}="${ctx}"]`, decls });
      if (mid === "_mode" && ctx === "dark") media.push({ at: "@media (prefers-color-scheme: dark)", rules: [{ sel: ":root:not([data-mode])", decls }] });
    }
  return { rules, media };
}
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

const PSEUDO: Record<string, string> = { hover: ":hover", pressed: ":active", focus: ":focus-visible", disabled: "[disabled]" };

const sorted = (m: Map<string, string>): Decl[] => [...m].sort(([a], [b]) => (a < b ? -1 : 1));

/** prev 상태에서 next 상태로 바꾸는 선언. prev에만 있는 선언은 `revert`다. */
function delta(prev: Map<string, string>, next: Map<string, string>): Map<string, string> {
  const d = new Map([...next].filter(([p, v]) => prev.get(p) !== v));
  for (const p of prev.keys()) if (!next.has(p)) d.set(p, "revert");
  return d;
}

function overlay(base: Map<string, string>, d: Map<string, string>): Map<string, string> {
  const out = new Map(base);
  for (const [p, v] of d) {
    if (v === "revert") out.delete(p);
    else out.set(p, v);
  }
  return out;
}

type Overrides = Map<string, Record<string, unknown>>;

/** 인스턴스의 `node.<경로>.<키>` 값을 경로별로 모은다. */
function overridesOf(inst: Obj): Overrides {
  const out: Overrides = new Map();
  for (const [k, v] of Object.entries(inst)) {
    if (!k.startsWith("node.")) continue;
    const dot = k.indexOf(".", 5);
    const path = k.slice(5, dot);
    out.set(path, { ...out.get(path), [k.slice(dot + 1)]: v });
  }
  return out;
}

export function build(doc: Doc, rootId: string, opts: BuildOpts = {}): Page {
  const objs = doc.objects;
  const root = objs[rootId];
  const bps = root.type === "frame" ? breakpointsOf(objs, rootId).map(([id, o]) => ({ id, min: o.minWidth as number })) : [];
  const used: string[] = [];
  const cache = new Map<string, Obj>();

  const css = (o: Obj): Obj => {
    for (const [k, v] of Object.entries(o))
      if (v && typeof v === "object" && "token" in v)
        o[k] = { css: `var(${cssVar(objs[(v as { token: string }).token].name as string)})` } satisfies Css;
    return o;
  };

  // sfx는 차례로 덮어쓸 조건 목록이다(예: ["@bp:b1", "@bp:b2"]). 조건이 정확히 같은 키만 기본키 값으로 덮어쓴다.
  const at = (id: string, sfx: string[]): Obj => {
    const key = `${id}|${sfx.join("")}`;
    let o = cache.get(key);
    if (!o) {
      const src = objs[id];
      o = Object.fromEntries(Object.entries(src).filter(([k]) => !k.includes("@"))) as Obj;
      for (const c of sfx)
        for (const [k, v] of Object.entries(src)) {
          const i = k.indexOf("@");
          if (i >= 0 && k.slice(i) === c) o[k.slice(0, i)] = v;
        }
      cache.set(key, css(o));
    }
    return o;
  };

  const cqsOf = (tree: string[]) =>
    [...new Set(tree.flatMap((id) => Object.keys(objs[id]).flatMap((k) => /@cq:(\d+)$/.exec(k)?.[1] ?? [])).map(Number))].sort((a, b) => a - b);
  const cqCache = new Map<string, number[]>();

  const declsAt = (id: string, sfx: string[], patch?: Record<string, unknown>): Map<string, string> => {
    const o = patch ? css({ ...at(id, sfx), ...patch }) : at(id, sfx);
    const parent = o.parent === null ? null : at(o.parent, sfx);
    const kids = childrenOf(objs, id);
    const d = [...(hasLayout(o) ? layoutDecls(o) : []), ...(parent ? childDecls(o, parent) : o.type === "frame" ? frameDecls(o) : [])];
    if (o.type === "component" && cqCache.get(id)?.length) d.push(["container-name", `c-${id}`], ["container-type", "inline-size"]);
    // absolute 노드는 그 자체로 기준 상자가 되므로 relative를 덧붙이지 않는다.
    if (o.position !== "absolute" && kids.some(([cid]) => at(cid, sfx).position === "absolute")) d.push(["position", "relative"]);
    for (const [k, v] of Object.entries(o)) if (k.startsWith("style.")) d.push([k.slice(6), value(v)]);
    const m = new Map(d);
    if (o.hidden) m.set("display", "none");
    return m;
  };

  const tree = (id: string): string[] => [id, ...childrenOf(objs, id).flatMap(([cid]) => tree(cid))];

  /** 인스턴스 override 중 CSS로 나가는 값(숨김, 토큰 바인딩)의 규칙. 원본 base 값을 대신하므로 변형·상태 규칙보다 약하다. */
  const overrideRules = (inst: string): Rule[] => {
    const comp = objs[inst].component as string;
    const out: Rule[] = [];
    for (const [path, keys] of [...overridesOf(objs[inst])].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const patch = Object.fromEntries(Object.entries(keys).filter(([k]) => k !== "content" && k !== "src" && k !== "alt"));
      const segs = path.split("/");
      const target = overrideTarget(objs, comp, segs);
      if (!target || !Object.keys(patch).length) continue;
      let cur = comp;
      let sel = `.n-${inst}`;
      segs.forEach((s, i) => {
        if (i < segs.length - 1) cur = objs[s].component as string;
        if (s !== cur) sel += ` .n-${s}`;
      });
      const d = delta(declsAt(target, []), declsAt(target, [], patch));
      if (d.size) out.push({ sel, decls: sorted(d) });
    }
    return out;
  };

  const sections: Rule[] = [];
  const containers: Media[] = [];
  const done = new Set<string>();
  const pseudo = (s: string) => (opts.preview ? `:is(${PSEUDO[s]}, [data-trama-state="${s}"])` : PSEUDO[s]);

  /** 컴포넌트 규칙을 한 번만 낸다. 중첩 인스턴스의 컴포넌트를 먼저 내 바깥 컴포넌트의 배치 규칙이 뒤에 오게 한다. */
  const ensure = (comp: string) => {
    if (done.has(comp)) return;
    done.add(comp);
    const ids = tree(comp);
    for (const id of ids) if (objs[id].type === "instance") ensure(objs[id].component as string);
    used.push(...ids);
    const cqs = cqsOf(ids);
    cqCache.set(comp, cqs);
    const sel = (id: string, scope: string) => (id === comp ? scope : `${scope} .n-${id}`);
    const base = new Map(ids.map((id) => [id, declsAt(id, [])]));
    for (const id of ids) {
      const d = base.get(id)!;
      if (d.size) sections.push({ sel: id === comp ? `.c-${comp}` : `.n-${id}`, decls: sorted(d) });
      if (objs[id].type === "instance") sections.push(...overrideRules(id));
    }
    const has = (cond: string) => ids.some((id) => Object.keys(objs[id]).some((k) => k.endsWith(cond)));
    const emit = (sfx: string[], scope: string, prev: (id: string) => Map<string, string>) => {
      for (const id of ids) {
        const d = delta(prev(id), declsAt(id, sfx));
        if (d.size) sections.push({ sel: sel(id, scope), decls: sorted(d) });
      }
    };
    const vars = componentPropsOf(objs, comp).flatMap(([cp, p]) =>
      optionsOf(p).map((opt) => ({ cond: `@var:${cp}=${opt}`, scope: `.c-${comp}[data-${p.name}="${opt}"]` })),
    );
    for (const v of vars) if (has(v.cond)) emit([v.cond], v.scope, (id) => base.get(id)!);
    for (const s of STATES) if (has(`@state:${s}`)) emit([`@state:${s}`], `.c-${comp}${pseudo(s)}`, (id) => base.get(id)!);
    for (const v of vars)
      for (const s of STATES) {
        const both = `${v.cond}@state:${s}`;
        if (!has(both)) continue;
        emit([v.cond, `@state:${s}`, both], `${v.scope}${pseudo(s)}`, (id) => {
          const b = base.get(id)!;
          return overlay(overlay(b, delta(b, declsAt(id, [v.cond]))), delta(b, declsAt(id, [`@state:${s}`])));
        });
      }
    cqs.forEach((n, i) => {
      const prev = cqs.slice(0, i).map((c) => `@cq:${c}`);
      const next = [...prev, `@cq:${n}`];
      const rules = ids.flatMap((id) => {
        const d = delta(declsAt(id, prev), declsAt(id, next));
        return d.size ? [{ sel: `.n-${id}`, decls: sorted(d) }] : [];
      });
      if (rules.length) containers.push({ at: `@container c-${comp} (min-width: ${n}px)`, rules });
    });
  };

  /** 컴포넌트 트리를 펼친 요소. 인스턴스면 inst가 그 ID이고, 요소 ID는 prefix를 붙인 경로다. */
  const expand = (comp: string, inst: string | null, values: Record<string, unknown>, over: Overrides, prefix: string, elId: string): El => {
    ensure(comp);
    const c = objs[comp];
    const attrs: [string, string][] = [["class", inst ? `c-${comp} n-${inst}` : `c-${comp}`]];
    for (const [cp, p] of componentPropsOf(objs, comp)) attrs.push([`data-${p.name}`, ((values[cp] as string) ?? p.default) as string]);
    if (!inst && opts.preview?.state) attrs.push(["data-trama-state", opts.preview.state]);
    const inner = (id: string): El => {
      const o = objs[id];
      const ov = over.get(id) ?? {};
      if (o.type === "instance") {
        const merged: Overrides = overridesOf(o);
        for (const [path, keys] of over) if (path.startsWith(`${id}/`)) merged.set(path.slice(id.length + 1), { ...merged.get(path.slice(id.length + 1)), ...keys });
        const values = Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("props.")).map(([k, v]) => [k.slice(6), v]));
        return expand(o.component as string, id, values, merged, `${prefix}${id}/`, prefix + id);
      }
      const a: [string, string][] = [["class", `n-${id}`]];
      if (o.type === "image") a.push(["src", ((ov.src ?? o.src) as string) ?? ""], ["alt", ((ov.alt ?? o.alt) as string) ?? ""]);
      return {
        id: prefix + id,
        tag: (o.tag as string) ?? DEFAULT_TAG[o.type],
        attrs: a,
        layout: hasLayout(o) ? mode(o) : null,
        text: o.type === "text" ? (((ov.content ?? o.content) as string) ?? "") : null,
        children: childrenOf(objs, id).map(([cid]) => inner(cid)),
      };
    };
    return {
      id: elId,
      tag: (c.tag as string) ?? "div",
      attrs,
      layout: mode(c),
      text: null,
      children: childrenOf(objs, comp).map(([cid]) => inner(cid)),
    };
  };

  const order: string[] = [];
  const visit = (id: string, o: Obj, isBody: boolean): El => {
    order.push(id);
    if (o.type === "instance") {
      const values = Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("props.")).map(([k, v]) => [k.slice(6), v]));
      return expand(o.component as string, id, values, overridesOf(o), `${id}/`, id);
    }
    const kids = childrenOf(objs, id);
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

  const body =
    root.type === "component"
      ? wrap("body", [], [expand(rootId, null, opts.preview?.props ?? {}, new Map(), "", rootId)])
      : visit(rootId, root, true);
  const rules: Rule[] = [RESET];
  if (Object.values(objs).some((o) => Object.keys(o).some((k) => k.startsWith("src@bp:"))))
    rules.push({ sel: "picture", decls: [["display", "contents"]] });
  const tokens = tokenRules(objs, [...used, ...order]);
  rules.push(...tokens.rules, ...sections);
  for (const id of order) {
    const d = declsAt(id, []);
    if (d.size) rules.push({ sel: `.n-${id}`, decls: sorted(d) });
    if (objs[id].type === "instance") rules.push(...overrideRules(id));
  }
  const media = bps.flatMap(({ min }, i): Media[] => {
    const prev = bps.slice(0, i).map((b) => `@bp:${b.id}`);
    const next = [...prev, `@bp:${bps[i].id}`];
    const changed: Rule[] = [];
    for (const id of order) {
      const d = delta(declsAt(id, prev), declsAt(id, next));
      if (d.size) changed.push({ sel: `.n-${id}`, decls: sorted(d) });
    }
    return changed.length ? [{ at: `@media (min-width: ${min}px)`, rules: changed }] : [];
  });
  return { title: (root.name as string) ?? "", safeArea: root.safeArea === true, body, rules, media: [...tokens.media, ...media, ...containers] };
}

const wrap = (tag: string, attrs: [string, string][], children: El[] = []): El => ({
  id: "",
  tag,
  attrs,
  layout: null,
  text: null,
  children,
});

const hasLayout = (o: Obj) => o.type === "frame" || o.type === "component" || o.type === "section" || o.type === "container";
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
