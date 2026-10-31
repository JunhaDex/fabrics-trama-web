import type { Doc, Obj } from "@/model";
import type { View } from "./store";

export type Rect = { x: number; y: number; w: number; h: number };

export const iframes = new Map<string, HTMLIFrameElement>();

/** Frame의 보드 위치와 미리보기 크기. 값이 없으면 기본값을 쓴다. */
export function frameBox(f: Obj): Rect {
  return {
    x: (f.boardX as number) ?? 0,
    y: (f.boardY as number) ?? 0,
    w: (f.previewWidth as number) ?? 390,
    h: (f.previewHeight as number) ?? 844,
  };
}

export function frameOf(doc: Doc, id: string): string {
  let cur = id;
  while (doc.objects[cur].parent !== null) cur = doc.objects[cur].parent!;
  return cur;
}

export function elementOf(doc: Doc, id: string): Element | null {
  return iframes.get(frameOf(doc, id))?.contentDocument?.querySelector(`[data-id="${id}"]`) ?? null;
}

/** 노드의 렌더 결과를 보드 좌표로 돌려준다. */
export function rectOf(doc: Doc, id: string): Rect | null {
  const el = elementOf(doc, id);
  if (!el) return null;
  const f = frameBox(doc.objects[frameOf(doc, id)]);
  const r = el.getBoundingClientRect();
  return { x: f.x + r.left, y: f.y + r.top, w: r.width, h: r.height };
}

/** 부모 좌상단 기준 rect. absolute로 바꿀 때 저장할 값이다. */
export function localRect(doc: Doc, id: string): Rect | null {
  const el = elementOf(doc, id);
  const parent = doc.objects[id].parent;
  const pel = parent && elementOf(doc, parent);
  if (!el || !pel) return null;
  const r = el.getBoundingClientRect();
  const p = pel.getBoundingClientRect();
  return { x: r.left - p.left, y: r.top - p.top, w: r.width, h: r.height };
}

export const toBoard = (view: View, box: DOMRect, cx: number, cy: number) => ({
  x: (cx - box.left - view.x) / view.zoom,
  y: (cy - box.top - view.y) / view.zoom,
});

/** 보드 좌표 아래에 있는 가장 안쪽 노드. Frame 밖이면 null이다. */
export function hit(frames: [string, Obj][], x: number, y: number) {
  for (const [fid, o] of [...frames].reverse()) {
    const f = frameBox(o);
    const lx = x - f.x;
    const ly = y - f.y;
    if (lx < 0 || ly < 0 || lx > f.w || ly > f.h) continue;
    const el = iframes.get(fid)?.contentDocument?.elementFromPoint(lx, ly)?.closest("[data-id]");
    return { frame: fid, id: el?.getAttribute("data-id") ?? fid };
  }
  return null;
}
