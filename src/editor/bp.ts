import { bpAllowed, breakpointsOf, frameOf, type Doc, type Obj } from "@/model";
import { frameBox } from "./geometry";
import { apply, useEditor } from "./store";

/** Frame의 현재 BP. 미리보기 폭 이하인 BP 중 가장 큰 것이며, 없으면 base(null)다. */
export function activeBp(doc: Doc, frame: string): string | null {
  const w = frameBox(doc.objects[frame]).w;
  let cur: string | null = null;
  for (const [id, bp] of breakpointsOf(doc.objects, frame)) if ((bp.minWidth as number) <= w) cur = id;
  return cur;
}

/** 노드가 속한 Frame의 현재 BP에서 적용되는 속성 값. */
export function effective(doc: Doc, id: string): Obj {
  const src = doc.objects[id];
  const frame = frameOf(doc.objects, id);
  const active = activeBp(doc, frame);
  const o = Object.fromEntries(Object.entries(src).filter(([k]) => !k.includes("@"))) as Obj;
  if (active === null) return o;
  for (const [bp] of breakpointsOf(doc.objects, frame)) {
    for (const [k, v] of Object.entries(src)) if (k.endsWith(`@bp:${bp}`)) o[k.slice(0, k.indexOf("@"))] = v;
    if (bp === active) break;
  }
  return o;
}

/** 현재 BP에서 키가 override되어 있는지. base에서는 항상 false다. */
export function overridden(doc: Doc, id: string, k: string): boolean {
  const active = activeBp(doc, frameOf(doc.objects, id));
  return active !== null && doc.objects[id][`${k}@bp:${active}`] !== undefined;
}

/**
 * 현재 BP에 맞춰 키를 쓴다. BP에서는 BP를 받는 키를 override로 쓰고 null이면 override를 지운다.
 * base에서는 def와 같은 값을 null(기본값)로 쓴다.
 */
export function write(id: string, k: string, v: unknown, def?: unknown) {
  const { doc } = useEditor.getState();
  const active = activeBp(doc, frameOf(doc.objects, id));
  if (active && bpAllowed(k)) return apply({ op: "set", id, props: { [`${k}@bp:${active}`]: v } });
  return apply({ op: "set", id, props: { [k]: v === def ? null : v } });
}

/** 여러 키를 한 트랜잭션으로 현재 BP에 맞춰 쓴다. */
export function writeAll(id: string, props: Record<string, unknown>) {
  const { doc } = useEditor.getState();
  const active = activeBp(doc, frameOf(doc.objects, id));
  const key = (k: string) => (active && bpAllowed(k) ? `${k}@bp:${active}` : k);
  return apply({ op: "set", id, props: Object.fromEntries(Object.entries(props).map(([k, v]) => [key(k), v])) });
}
