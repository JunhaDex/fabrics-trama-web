import { childrenOf, PARENTS, type Doc, type Placement } from "@/model";
import { rectOf, type Rect } from "./geometry";

export type Drop = { parent: string; placement: Placement; line: Rect };

const LAYOUT = ["frame", "section", "container"];

function within(doc: Doc, id: string, ancestor: string) {
  for (let cur: string | null = id; cur; cur = doc.objects[cur].parent) if (cur === ancestor) return true;
  return false;
}

/** 드래그 중인 노드를 놓을 부모와 삽입 위치. 놓을 수 없으면 null이다. */
export function dropTarget(doc: Doc, drag: string, over: string, x: number, y: number): Drop | null {
  const type = doc.objects[drag].type;
  for (let cur: string | null = over; cur; cur = doc.objects[cur].parent) {
    const o = doc.objects[cur];
    if (within(doc, cur, drag) || !LAYOUT.includes(o.type) || !PARENTS[type].includes(o.type)) continue;
    return place(doc, cur, drag, x, y);
  }
  return null;
}

function place(doc: Doc, parent: string, drag: string, x: number, y: number): Drop | null {
  const kids = childrenOf(doc.objects, parent)
    .filter(([id, c]) => id !== drag && c.position !== "absolute")
    .map(([id]) => ({ id, r: rectOf(doc, id) }))
    .filter((k): k is { id: string; r: Rect } => k.r !== null);
  const mode = (doc.objects[parent]["layout.mode"] as string) ?? "flex-column";
  const row = mode === "flex-row";
  if (!kids.length) {
    const p = rectOf(doc, parent);
    return p && { parent, placement: "last", line: { x: p.x, y: p.y, w: p.w, h: 0 } };
  }
  const i = kids.findIndex(({ r }) =>
    mode === "grid"
      ? y < r.y || (y < r.y + r.h && x < r.x + r.w / 2)
      : row
        ? x < r.x + r.w / 2
        : y < r.y + r.h / 2,
  );
  const at = i < 0 ? kids[kids.length - 1].r : kids[i].r;
  const edge = i < 0;
  const line = row
    ? { x: edge ? at.x + at.w : at.x, y: at.y, w: 0, h: at.h }
    : { x: at.x, y: edge ? at.y + at.h : at.y, w: at.w, h: 0 };
  return { parent, placement: edge ? "last" : { before: kids[i].id }, line };
}
