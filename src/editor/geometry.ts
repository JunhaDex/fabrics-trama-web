import { frameOf, type Doc, type Obj } from "@/model";
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

export function elementOf(doc: Doc, id: string): Element | null {
  return iframes.get(frameOf(doc.objects, id))?.contentDocument?.querySelector(`[data-id="${id}"]`) ?? null;
}

/** 노드의 렌더 결과를 보드 좌표로 돌려준다. */
export function rectOf(doc: Doc, id: string): Rect | null {
  const el = elementOf(doc, id);
  if (!el) return null;
  const f = frameBox(doc.objects[frameOf(doc.objects, id)]);
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

export type Scan = { contentH: number; over: { id: string; r: Rect }[]; clipped: string[] };

/**
 * Frame의 렌더 결과를 검사한다. contentH는 내용 높이, clipped는 clip으로 자식을 자르고 있는 노드다.
 * over는 부모 밖으로 가로로 넘친 노드이며, checkOver가 참일 때만 검사한다.
 */
export function scan(el: HTMLIFrameElement, checkOver: boolean): Scan | null {
  const d = el.contentDocument;
  const win = d?.defaultView;
  if (!d?.body || !win) return null;
  const out: Scan = { contentH: Math.ceil(d.body.getBoundingClientRect().bottom), over: [], clipped: [] };
  for (const e of d.querySelectorAll<HTMLElement>("[data-id]")) {
    const id = e.dataset.id!;
    const s = win.getComputedStyle(e);
    if (s.overflowX === "hidden" && (e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight)) out.clipped.push(id);
    if (!checkOver || e === d.body || s.position === "absolute" || s.display === "none") continue;
    const p = e.parentElement?.closest<HTMLElement>("[data-id]");
    if (!p || win.getComputedStyle(p).overflowX === "hidden") continue;
    const r = e.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    if (r.right > pr.right + 0.5 || r.left < pr.left - 0.5) out.over.push({ id, r: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  return out;
}

/**
 * srcdoc을 SVG foreignObject 이미지로 바꾼 data URL. 화면 밖 Frame의 정적 스냅샷에 쓴다.
 * SVG 이미지는 외부 리소스를 불러오지 않으므로 외부 이미지는 스냅샷에 나타나지 않는다.
 */
export function snapshot(html: string, w: number, h: number): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const xml = new XMLSerializer();
  const style = [...doc.querySelectorAll("style")].map((s) => xml.serializeToString(s)).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
    `<html xmlns="http://www.w3.org/1999/xhtml"><head>${style}</head>${xml.serializeToString(doc.body)}</html></foreignObject></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** 보드 좌표 아래에 있는 가장 안쪽 노드. Frame 밖이면 null이다. */
export function hit(frames: [string, Obj][], x: number, y: number) {
  for (const [fid, o] of [...frames].reverse()) {
    const f = frameBox(o);
    const frame = iframes.get(fid);
    const lx = x - f.x;
    const ly = y - f.y;
    if (lx < 0 || ly < 0 || lx > (frame?.offsetWidth ?? f.w) || ly > (frame?.offsetHeight ?? f.h)) continue;
    const el = frame?.contentDocument?.elementFromPoint(lx, ly)?.closest("[data-id]");
    return { frame: fid, id: el?.getAttribute("data-id") ?? fid };
  }
  return null;
}
