"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { breakpointsOf, childrenOf, modifiersOf, type Doc, type Obj } from "@/model";
import { build, toSrcdoc } from "@/render";
import { dropTarget, type Drop } from "./drop";
import { frameBox, hit, iframes, rectOf, scan, snapshot, toBoard, type Rect, type Scan } from "./geometry";
import { activeBp, effective, writeAll } from "./bp";
import { apply, select, useEditor } from "./store";
import { isTyping } from "./keys";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "node"; id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean; origin: Rect | null; drop: Drop | null };

export function Board() {
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const [box, setBox] = useState<Rect | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const heights = useEditor((s) => s.heights);
  const ctx = useEditor((s) => s.ctx);
  const attrs = useMemo(() => ctxAttrs(doc, ctx), [doc, ctx]);

  useEffect(() => {
    for (const el of iframes.values()) applyCtx(el, attrs);
  }, [attrs]);
  const [ghost, setGhost] = useState<{ rect?: Rect; line?: Rect } | null>(null);
  const frames = childrenOf(doc.objects, null);

  const measure = useCallback(() => {
    const { doc, selected } = useEditor.getState();
    setBox(selected ? rectOf(doc, selected) : null);
  }, []);

  useEffect(() => useEditor.subscribe((s, p) => s.selected !== p.selected && measure()), [measure]);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const live = (id: string, f: Obj) => {
    if (!size.w) return true;
    if (view.zoom < 0.25) return false;
    const b = frameBox(f);
    const m = 200 / view.zoom;
    const x0 = -view.x / view.zoom - m;
    const y0 = -view.y / view.zoom - m;
    const x1 = (size.w - view.x) / view.zoom + m;
    const y1 = (size.h - view.y) / view.zoom + m;
    const w = Math.max(b.w, (f.minWidth as number) ?? 320);
    const h = Math.max(b.h, heights[id] ?? 0);
    return b.x < x1 && b.x + w > x0 && b.y < y1 && b.y + h > y0;
  };

  useEffect(() => {
    const el = ref.current!;
    // React의 onWheel은 passive라 preventDefault가 듣지 않으므로 직접 등록한다.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useEditor.getState().view;
      if (!e.ctrlKey && !e.metaKey) {
        useEditor.setState({ view: { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY } });
        return;
      }
      const b = el.getBoundingClientRect();
      const px = e.clientX - b.left;
      const py = e.clientY - b.top;
      const zoom = Math.min(8, Math.max(0.1, v.zoom * Math.exp(-e.deltaY * 0.01)));
      const k = zoom / v.zoom;
      useEditor.setState({ view: { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k } });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) space.current = e.type === "keydown";
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const point = (e: PointerEvent) => toBoard(view, ref.current!.getBoundingClientRect(), e.clientX, e.clientY);

  const onPointerDown = (e: PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    const pan: Drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    if (e.button === 1 || space.current) return void (drag.current = pan);
    if (e.button !== 0) return;
    const p = point(e);
    const h = hit(frames, p.x, p.y);
    if (!h) {
      select(null);
      drag.current = pan;
      return;
    }
    select(h.id);
    if (h.id !== h.frame)
      drag.current = { kind: "node", id: h.id, sx: p.x, sy: p.y, dx: 0, dy: 0, moved: false, origin: rectOf(doc, h.id), drop: null };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      useEditor.setState({ view: { ...view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy } });
      return;
    }
    const p = point(e);
    d.dx = p.x - d.sx;
    d.dy = p.y - d.sy;
    if (!d.moved && Math.hypot(d.dx, d.dy) * view.zoom < 4) return;
    d.moved = true;
    if (effective(doc, d.id).position === "absolute") {
      setGhost(d.origin && { rect: { ...d.origin, x: d.origin.x + d.dx, y: d.origin.y + d.dy } });
      return;
    }
    const h = hit(frames, p.x, p.y);
    d.drop = h && dropTarget(doc, d.id, h.id, p.x, p.y);
    setGhost(d.drop && { line: d.drop.line });
  };

  const onPointerUp = (e: PointerEvent) => {
    onPointerMove(e);
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (d?.kind !== "node" || !d.moved) return;
    const o = effective(doc, d.id);
    if (o.position === "absolute") {
      writeAll(d.id, { x: Math.round(((o.x as number) ?? 0) + d.dx), y: Math.round(((o.y as number) ?? 0) + d.dy) });
    } else if (d.drop) apply({ op: "move", id: d.id, parent: d.drop.parent, placement: d.drop.placement });
  };

  const px = 2 / view.zoom;
  return (
    <div
      ref={ref}
      className="relative h-full touch-none select-none overflow-hidden bg-neutral-subtle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {frames.map(([id, f]) => (
          <FrameView key={id} id={id} frame={f} doc={doc} onLoad={measure} hair={1 / view.zoom} live={live(id, f)} attrs={attrs} />
        ))}
        {box && <Outline rect={box} width={px} />}
        {ghost?.rect && <Outline rect={ghost.rect} width={px} dashed />}
        {ghost?.line && (
          <div
            className="pointer-events-none absolute bg-brand"
            style={{ left: ghost.line.x - px / 2, top: ghost.line.y - px / 2, width: ghost.line.w || px, height: ghost.line.h || px }}
          />
        )}
      </div>
    </div>
  );
}

/** 미리보기 컨텍스트를 `<html>`의 data 속성으로 바꾼다. 기본 컨텍스트도 명시해 OS 다크 모드 설정과 무관하게 보인다. */
function ctxAttrs(doc: Doc, ctx: Record<string, string>): Record<string, string> {
  return Object.fromEntries(modifiersOf(doc.objects).map(([, m]) => [`data-${m.name}`, ctx[m.name as string] ?? (m.default as string)]));
}

function applyCtx(el: HTMLIFrameElement, attrs: Record<string, string>) {
  const root = el.contentDocument?.documentElement;
  if (root) for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
}

type FrameProps = { id: string; frame: Obj; doc: Doc; onLoad: () => void; hair: number; live: boolean; attrs: Record<string, string> };

const FrameView = memo(function FrameView({ id, frame, doc, onLoad, hair, live, attrs }: FrameProps) {
  const html = useMemo(() => toSrcdoc(build(doc, id)), [doc, id]);
  const [res, setRes] = useState<Scan | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const b = frameBox(frame);
  const minWidth = (frame.minWidth as number) ?? 320;
  // 미리보기가 minWidth보다 좁아도 그 구간에는 BP가 없으므로, minWidth 폭으로 그려도 출력이 같다.
  const w = Math.max(b.w, minWidth);
  const h = Math.max(b.h, res?.contentH ?? 0);

  const load = () => {
    const el = iframes.get(id);
    const body = el?.contentDocument?.body;
    if (!el || !body) return;
    applyCtx(el, attrs);
    const run = () => {
      const cur = frameBox(useEditor.getState().doc.objects[id]);
      const r = scan(el, cur.w >= minWidth);
      setRes(r);
      useEditor.setState((s) => ({ clipped: { ...s.clipped, [id]: r?.clipped ?? [] }, heights: { ...s.heights, [id]: r?.contentH ?? 0 } }));
      onLoad();
    };
    observer.current?.disconnect();
    observer.current = new ResizeObserver(run);
    observer.current.observe(body);
  };

  useEffect(() => () => observer.current?.disconnect(), []);
  const still = useMemo(() => (live ? null : snapshot(html, w, h, attrs)), [live, html, w, h, attrs]);

  return (
    <div className="absolute" style={{ left: b.x, top: b.y }}>
      <FrameBar id={id} frame={frame} doc={doc} />
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL 스냅샷이라 next/image 최적화가 필요 없다.
        <img src={still} alt="" className="pointer-events-none block max-w-none" style={{ width: w, height: h, background: "#fff" }} />
      ) : (
        <iframe
          ref={(el) => {
            if (!el) return;
            iframes.set(id, el);
            return () => void iframes.delete(id);
          }}
          title={(frame.name as string) ?? id}
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={load}
          className="pointer-events-none block border-0"
          style={{ width: w, height: h, background: "#fff" }}
        />
      )}
      {h > b.h && (
        <div
          className="pointer-events-none absolute left-0"
          style={{ top: b.h, width: w, height: h - b.h, background: "rgb(0 0 0 / 0.06)", borderTop: `${hair}px dashed rgb(0 0 0 / 0.45)` }}
        />
      )}
      {b.w < minWidth && (
        <div
          className="pointer-events-none absolute top-0"
          style={{ left: b.w, width: minWidth - b.w, height: h, background: "rgb(128 128 128 / 0.12)", outline: `${hair}px dashed rgb(128 128 128 / 0.8)` }}
        />
      )}
      {res?.over.map(({ id: oid, r }) => (
        <div
          key={oid}
          className="pointer-events-none absolute"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, outline: `${2 * hair}px solid rgb(220 38 38)` }}
        />
      ))}
    </div>
  );
});

const drawnWidth = (f: Obj) => Math.max(frameBox(f).w, (f.minWidth as number) ?? 320);

/** Frame 미리보기 폭을 바꾸고, 오른쪽에 있으면서 세로로 겹치는 Frame을 폭 변화만큼 함께 옮긴다. */
function resizeFrame(doc: Doc, id: string, width: number) {
  const f = doc.objects[id];
  const b = frameBox(f);
  const delta = Math.max(width, (f.minWidth as number) ?? 320) - drawnWidth(f);
  const { heights } = useEditor.getState();
  const bottom = (fid: string, o: Obj) => frameBox(o).y + Math.max(frameBox(o).h, heights[fid] ?? 0);
  const shifted = delta
    ? childrenOf(doc.objects, null).filter(([oid, o]) => {
        const ob = frameBox(o);
        return oid !== id && ob.x >= b.x + drawnWidth(f) && ob.y < bottom(id, f) && bottom(oid, o) > b.y;
      })
    : [];
  apply(
    { op: "set", id, props: { previewWidth: width } },
    ...shifted.map(([oid, o]) => ({ op: "set" as const, id: oid, props: { boardX: frameBox(o).x + delta } })),
  );
}

function FrameBar({ id, frame, doc }: { id: string; frame: Obj; doc: Doc }) {
  const active = activeBp(doc, id);
  const minWidth = (frame.minWidth as number) ?? 320;
  const tabs: [string | null, string, number][] = [
    [null, (frame.baseLabel as string) ?? "Mobile", Math.max(390, minWidth)],
    ...breakpointsOf(doc.objects, id).map(([bid, bp]): [string, string, number] => [bid, (bp.name as string) || "BP", bp.minWidth as number]),
  ];
  return (
    <div
      className="absolute bottom-full mb-1 flex items-center gap-2 whitespace-nowrap text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-on-surface-muted">{(frame.name as string) ?? ""}</span>
      {tabs.map(([bid, name, width]) => (
        <button
          key={bid ?? "base"}
          type="button"
          onClick={() => resizeFrame(doc, id, width)}
          className={`rounded px-1.5 py-0.5 ${bid === active ? "bg-brand text-on-brand" : "text-on-surface-muted hover:bg-surface-raised"}`}
        >
          {name} {bid && <span className="opacity-70">{width}</span>}
        </button>
      ))}
    </div>
  );
}

function Outline({ rect, width, dashed }: { rect: Rect; width: number; dashed?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute outline-brand"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, outlineWidth: width, outlineStyle: dashed ? "dashed" : "solid" }}
    />
  );
}
