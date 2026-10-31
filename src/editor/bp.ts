import { breakpointsOf, condAllowed, frameOf, parseKey, type Condition, type Doc, type Obj } from "@/model";
import { frameBox } from "./geometry";
import { apply, compView, useEditor } from "./store";

/** Frame의 현재 BP. 미리보기 폭 이하인 BP 중 가장 큰 것이며, 없으면 base(null)다. */
export function activeBp(doc: Doc, frame: string): string | null {
  const w = frameBox(doc.objects[frame]).w;
  let cur: string | null = null;
  for (const [id, bp] of breakpointsOf(doc.objects, frame)) if ((bp.minWidth as number) <= w) cur = id;
  return cur;
}

/** 컴포넌트 트리의 컨테이너 쿼리 기준(px). 키에 쓰인 값과 편집기에서 추가한 값을 오름차순으로 돌려준다. */
export function cqsOf(doc: Doc, comp: string): number[] {
  const found = Object.entries(doc.objects)
    .filter(([id]) => frameOf(doc.objects, id) === comp)
    .flatMap(([, o]) => Object.keys(o).flatMap((k) => /@cq:(\d+)$/.exec(k)?.[1] ?? []).map(Number));
  return [...new Set([...found, ...compView(comp).cqs])].sort((a, b) => a - b);
}

/** 컴포넌트 미리보기 폭 이하인 컨테이너 쿼리 기준 중 가장 큰 것. 없으면 null이다. */
export function activeCq(doc: Doc, comp: string): number | null {
  const w = frameBox(doc.objects[comp]).w;
  return cqsOf(doc, comp).filter((n) => n <= w).at(-1) ?? null;
}

/**
 * 루트의 편집 문맥. layers는 미리보기에 적용되는 조건(덮어쓰기 순서), target은 편집이 쓰는 조건이다(null이면 base).
 * Frame은 현재 BP, 컴포넌트는 고른 변형·상태가 있으면 그것, 없으면 현재 컨테이너 쿼리다.
 */
export function context(doc: Doc, root: string): { layers: string[]; target: string | null } {
  if (doc.objects[root].type === "frame") {
    const active = activeBp(doc, root);
    const layers: string[] = [];
    for (const [id] of breakpointsOf(doc.objects, root)) {
      if (active === null) break;
      layers.push(`@bp:${id}`);
      if (id === active) break;
    }
    return { layers, target: active && `@bp:${active}` };
  }
  const cq = activeCq(doc, root);
  const cqs = cq === null ? [] : cqsOf(doc, root).filter((n) => n <= cq).map((n) => `@cq:${n}`);
  const v = compView(root);
  const varC = v.var && `@var:${v.var[0]}=${v.var[1]}`;
  const stateC = v.state && `@state:${v.state}`;
  const layers = [...cqs, ...(varC ? [varC] : []), ...(stateC ? [stateC] : []), ...(varC && stateC ? [varC + stateC] : [])];
  return { layers, target: varC || stateC ? `${varC ?? ""}${stateC ?? ""}` : (cqs.at(-1) ?? null) };
}

/** 노드가 속한 루트의 편집 문맥에서 적용되는 속성 값. */
export function effective(doc: Doc, id: string): Obj {
  const src = doc.objects[id];
  const o = Object.fromEntries(Object.entries(src).filter(([k]) => !k.includes("@"))) as Obj;
  for (const c of context(doc, frameOf(doc.objects, id)).layers)
    for (const [k, v] of Object.entries(src)) {
      const i = k.indexOf("@");
      if (i >= 0 && k.slice(i) === c) o[k.slice(0, i)] = v;
    }
  return o;
}

/** 키를 편집 문맥의 조건 키로 쓸 수 있으면 그 키를, 아니면 null을 돌려준다. */
function condKey(doc: Doc, id: string, k: string): string | null {
  const root = frameOf(doc.objects, id);
  const { target } = context(doc, root);
  if (!target) return null;
  const key = parseKey(k + target);
  const conds = (["bp", "cq", "var", "state"] as Condition[]).filter((c) => key?.[c] !== undefined);
  if (!key || conds.some((c) => !condAllowed(k, c)) || (key.cq !== undefined && id === root)) return null;
  return k + target;
}

/** 편집 문맥에서 키가 override되어 있는지. base에서는 항상 false다. */
export function overridden(doc: Doc, id: string, k: string): boolean {
  const ck = condKey(doc, id, k);
  return ck !== null && doc.objects[id][ck] !== undefined;
}

/**
 * 편집 문맥에 맞춰 키를 쓴다. 조건을 받는 키는 그 조건의 override로 쓰고 null이면 override를 지운다.
 * base에서는 def와 같은 값을 null(기본값)로 쓴다.
 */
export function write(id: string, k: string, v: unknown, def?: unknown) {
  const { doc } = useEditor.getState();
  const ck = condKey(doc, id, k);
  if (ck) return apply({ op: "set", id, props: { [ck]: v } });
  return apply({ op: "set", id, props: { [k]: v === def ? null : v } });
}

/** 여러 키를 한 트랜잭션으로 편집 문맥에 맞춰 쓴다. */
export function writeAll(id: string, props: Record<string, unknown>) {
  const { doc } = useEditor.getState();
  return apply({ op: "set", id, props: Object.fromEntries(Object.entries(props).map(([k, v]) => [condKey(doc, id, k) ?? k, v])) });
}
