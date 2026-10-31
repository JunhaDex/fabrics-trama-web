"use client";

import { Button, Icon } from "@junhadex/core";
import { ArrowDown, ArrowUp, EyeOff, Trash2 } from "lucide";
import { childrenOf, frameOf, PARENTS, type Doc, type NodeType, type Placement } from "@/model";
import { activeBp, effective } from "./bp";
import { frameBox } from "./geometry";
import { apply, newId, select, useEditor } from "./store";

const LABEL: Record<NodeType, string> = {
  frame: "Frame",
  section: "Section",
  container: "Container",
  text: "Text",
  image: "Image",
};

const DEFAULTS: Partial<Record<NodeType, Record<string, unknown>>> = {
  section: { "size.minHeight": { value: 80, unit: "px" } },
  container: { "size.minHeight": { value: 80, unit: "px" } },
  text: { content: "텍스트" },
  image: { "size.width": { value: 120, unit: "px" }, "size.height": { value: 80, unit: "px" } },
};

/** 선택 상태에서 type 노드를 넣을 위치. 선택한 노드가 받을 수 있으면 그 안, 아니면 그 뒤다. */
function target(doc: Doc, sel: string | null, type: NodeType): { parent: string; placement: Placement } | null {
  if (!sel) return null;
  const o = doc.objects[sel];
  if (PARENTS[type].includes(o.type)) return { parent: sel, placement: "last" };
  const p = o.parent;
  return p && PARENTS[type].includes(doc.objects[p].type) ? { parent: p, placement: { after: sel } } : null;
}

function addFrame(doc: Doc) {
  const frames = childrenOf(doc.objects, null);
  const x = Math.max(-80, ...frames.map(([, f]) => frameBox(f).x + frameBox(f).w)) + 80;
  const id = newId();
  const r = apply(
    {
      op: "create",
      id,
      type: "frame",
      parent: null,
      placement: "last",
      props: { name: `Frame ${frames.length + 1}`, boardX: x, boardY: 0, previewWidth: 390, previewHeight: 844 },
    },
    { op: "create", id: newId(), type: "breakpoint", parent: id, props: { name: "Tablet", minWidth: 768 } },
    { op: "create", id: newId(), type: "breakpoint", parent: id, props: { name: "Desktop", minWidth: 1280 } },
  );
  if (r.ok) select(id);
}

function add(doc: Doc, sel: string | null, type: NodeType) {
  const t = target(doc, sel, type);
  if (!t) return;
  const id = newId();
  const r = apply({ op: "create", id, type, ...t, props: DEFAULTS[type] });
  if (r.ok) select(id);
}

function shift(doc: Doc, id: string, dir: -1 | 1) {
  const parent = doc.objects[id].parent;
  const sibs = childrenOf(doc.objects, parent);
  const i = sibs.findIndex(([s]) => s === id) + dir;
  if (i < 0 || i >= sibs.length) return;
  apply({ op: "move", id, parent, placement: dir < 0 ? { before: sibs[i][0] } : { after: sibs[i][0] } });
}

export function Layers() {
  const doc = useEditor((s) => s.doc);
  const sel = useEditor((s) => s.selected);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        <Button size="sm" variant="secondary" onClick={() => addFrame(doc)}>
          + Frame
        </Button>
        {(["section", "container", "text", "image"] as const).map((t) => (
          <Button key={t} size="sm" variant="ghost" disabled={!target(doc, sel, t)} onClick={() => add(doc, sel, t)}>
            + {LABEL[t]}
          </Button>
        ))}
      </div>
      <ul role="tree" aria-label="레이어" className="flex-1 overflow-auto py-1 text-sm">
        {childrenOf(doc.objects, null).map(([id]) => (
          <Layer key={id} doc={doc} id={id} sel={sel} depth={0} />
        ))}
      </ul>
      {sel && (
        <div className="flex gap-1 border-t border-border p-2">
          <Button size="sm" variant="ghost" aria-label="위로" onClick={() => shift(doc, sel, -1)}>
            <Icon node={ArrowUp} />
          </Button>
          <Button size="sm" variant="ghost" aria-label="아래로" onClick={() => shift(doc, sel, 1)}>
            <Icon node={ArrowDown} />
          </Button>
          <Button size="sm" variant="ghost" aria-label="삭제" onClick={() => apply({ op: "delete", id: sel })}>
            <Icon node={Trash2} />
          </Button>
        </div>
      )}
    </div>
  );
}

function Layer({ doc, id, sel, depth }: { doc: Doc; id: string; sel: string | null; depth: number }) {
  const o = doc.objects[id];
  const type = o.type as NodeType;
  const kids = childrenOf(doc.objects, id);
  const label = (o.name as string) || (type === "text" ? (o.content as string) : "") || LABEL[type];
  const bp = activeBp(doc, frameOf(doc.objects, id));
  const hidden = effective(doc, id).hidden === true;
  return (
    <li role="treeitem" aria-selected={id === sel} aria-expanded={kids.length ? true : undefined}>
      <button
        type="button"
        onClick={() => select(id)}
        className={`flex w-full items-center gap-2 truncate py-1 pr-2 text-left hover:bg-surface-raised ${id === sel ? "bg-brand-subtle text-on-brand-subtle" : ""} ${hidden ? "text-on-surface-muted" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="text-xs text-on-surface-muted">{LABEL[type][0]}</span>
        <span className="truncate">{label}</span>
        {hidden && (
          <span className="ml-auto flex items-center gap-1 text-xs text-on-surface-muted" title="현재 BP에서 숨김">
            <Icon node={EyeOff} />
            {bp ? (doc.objects[bp].name as string) || `${doc.objects[bp].minWidth}` : "base"}
          </span>
        )}
      </button>
      {kids.length > 0 && (
        <ul role="group">
          {kids.map(([cid]) => (
            <Layer key={cid} doc={doc} id={cid} sel={sel} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
