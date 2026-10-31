"use client";

import { Button, Icon, Input, Select } from "@junhadex/core";
import { Plus, Trash2 } from "lucide";
import {
  BIND_TYPE,
  childrenOf,
  componentPropsOf,
  detachId,
  frameOf,
  KEYS,
  optionsOf,
  tokensOf,
  type Doc,
  type Obj,
  type Op,
} from "@/model";
import { rectOf } from "./geometry";
import { nextBoardX } from "./layers";
import { apply, compView, newId, select, setCompView } from "./store";

const isBinding = (v: unknown): v is { token: string } => typeof v === "object" && v !== null && "token" in v;
const field = "h-8 w-full rounded border border-border bg-surface px-2 text-xs";

/** 컨테이너를 같은 내용의 컴포넌트로 바꾸고 그 자리에 인스턴스를 둔다. 자식의 조건 키는 루트가 바뀌므로 지워진다. */
export function toComponent(doc: Doc, id: string) {
  const o = doc.objects[id];
  const comp = newId();
  const inst = newId();
  const r = rectOf(doc, id);
  const own = (k: string) => !k.includes("@") && k !== "hidden" && Object.hasOwn(KEYS.component, k);
  const placed = (k: string) => k !== "component" && Object.hasOwn(KEYS.instance, k.split("@")[0]);
  const res = apply(
    {
      op: "create",
      id: comp,
      type: "component",
      parent: null,
      placement: "last",
      props: {
        ...Object.fromEntries(Object.entries(o).filter(([k]) => own(k))),
        name: (o.name as string) || "Component",
        boardX: nextBoardX(doc),
        boardY: 0,
        previewWidth: Math.round(r?.w ?? 320),
        previewHeight: Math.round(r?.h ?? 120),
      },
    },
    ...childrenOf(doc.objects, id).map(([cid]): Op => ({ op: "move", id: cid, parent: comp, placement: "last" })),
    {
      op: "create",
      id: inst,
      type: "instance",
      parent: o.parent,
      placement: { after: id },
      props: { ...Object.fromEntries(Object.entries(o).filter(([k]) => placed(k))), component: comp },
    },
    { op: "delete", id },
  );
  if (res.ok) select(inst);
}

/** 컴포넌트 속성(변형 축) 편집기. */
export function ComponentProps({ doc, comp }: { doc: Doc; comp: string }) {
  const cps = componentPropsOf(doc.objects, comp);
  const add = () => {
    const names = new Set(cps.map(([, p]) => p.name));
    let n = 1;
    while (names.has(`prop${n}`)) n++;
    apply({ op: "create", id: newId(), type: "componentProp", parent: comp, props: { name: `prop${n}`, kind: "boolean", default: "false" } });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-on-surface-muted">속성(변형)</span>
        <Button size="sm" variant="ghost" onClick={add}>
          + 속성
        </Button>
      </div>
      {cps.map(([cp, p]) => (
        <PropRow key={cp} doc={doc} comp={comp} cp={cp} p={p} />
      ))}
    </div>
  );
}

function PropRow({ doc, comp, cp, p }: { doc: Doc; comp: string; cp: string; p: Obj }) {
  const opts = optionsOf(p);
  const setKind = (kind: string) =>
    apply({ op: "set", id: cp, props: kind === "enum" ? { kind, options: ["a", "b"], default: "a" } : { kind, options: null, default: "false" } });
  const setOptions = (next: string[], def = p.default as string) =>
    apply({ op: "set", id: cp, props: { options: next, default: next.includes(def) ? def : next[0] } });
  const rename = (old: string, name: string) => {
    if (!name || name === old || opts.includes(name)) return;
    const from = `@var:${cp}=${old}`;
    const to = `@var:${cp}=${name}`;
    const nodes = Object.entries(doc.objects).filter(([id]) => frameOf(doc.objects, id) === comp);
    const ops: Op[] = [
      { op: "set", id: cp, props: { options: opts.map((o) => (o === old ? name : o)), default: p.default === old ? name : p.default } },
      ...nodes.flatMap(([id, o]): Op[] => {
        const moved = Object.entries(o).filter(([k]) => k.includes(from));
        return moved.length ? [{ op: "set", id, props: Object.fromEntries(moved.map(([k, v]) => [k.replace(from, to), v])) }] : [];
      }),
      ...Object.entries(doc.objects)
        .filter(([, o]) => o.type === "instance" && o[`props.${cp}`] === old)
        .map(([id]): Op => ({ op: "set", id, props: { [`props.${cp}`]: name } })),
    ];
    const r = apply(...ops);
    const v = compView(comp).var;
    if (r.ok && v?.[0] === cp && v[1] === old) setCompView(comp, { var: [cp, name] });
  };
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2">
      <div className="grid grid-cols-[1fr_96px_auto] items-center gap-1">
        <Input
          key={`n${p.name}`}
          size="sm"
          aria-label="속성 이름"
          defaultValue={p.name as string}
          onBlur={(e) => e.target.value !== p.name && apply({ op: "set", id: cp, props: { name: e.target.value } })}
        />
        <Select
          size="sm"
          aria-label="속성 종류"
          options={["enum", "boolean"].map((k) => ({ value: k, label: k }))}
          value={p.kind as string}
          onValueChange={setKind}
        />
        <Button size="sm" variant="ghost" aria-label="속성 삭제" onClick={() => apply({ op: "delete", id: cp })}>
          <Icon node={Trash2} />
        </Button>
      </div>
      {p.kind === "enum" &&
        opts.map((o) => (
          <div key={o} className="grid grid-cols-[1fr_auto] items-center gap-1 pl-3">
            <Input key={o} size="sm" aria-label="옵션 이름" defaultValue={o} onBlur={(e) => rename(o, e.target.value)} />
            <Button
              size="sm"
              variant="ghost"
              aria-label="옵션 삭제"
              disabled={opts.length < 2}
              onClick={() => setOptions(opts.filter((x) => x !== o))}
            >
              <Icon node={Trash2} />
            </Button>
          </div>
        ))}
      {p.kind === "enum" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            let n = opts.length + 1;
            while (opts.includes(`opt${n}`)) n++;
            setOptions([...opts, `opt${n}`]);
          }}
        >
          <Icon node={Plus} /> 옵션
        </Button>
      )}
      <label className="grid grid-cols-[56px_1fr] items-center gap-1 text-xs">
        기본값
        <select className={field} value={p.default as string} onChange={(e) => apply({ op: "set", id: cp, props: { default: e.target.value } })}>
          {opts.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

type Target = { path: string; id: string; o: Obj; depth: number; root: boolean };

/** 인스턴스에서 override할 수 있는 노드. 중첩 인스턴스 안의 노드는 `/`로 이은 경로를 갖는다. */
function targets(doc: Doc, comp: string, prefix = "", depth = 0): Target[] {
  const walk = (id: string, d: number): Target[] => {
    const o = doc.objects[id];
    const self: Target = { path: prefix + id, id, o, depth: d, root: id === comp };
    if (o.type === "instance") return [self, ...targets(doc, o.component as string, `${prefix}${id}/`, d + 1)];
    return [self, ...childrenOf(doc.objects, id).flatMap(([cid]) => walk(cid, d + 1))];
  };
  return walk(comp, depth);
}

/** 인스턴스 패널. 속성 값, 노드별 override(텍스트, 이미지, 숨김, 토큰), 원본 이동, 연결 해제. */
export function InstancePanel({ doc, id }: { doc: Doc; id: string }) {
  const inst = doc.objects[id];
  const comp = inst.component as string;
  const set = (props: Record<string, unknown>) => apply({ op: "set", id, props });
  const detach = () => {
    const r = apply({ op: "detach", id });
    if (r.ok) select(detachId(id, comp));
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={() => select(comp)}>
          원본: {(doc.objects[comp].name as string) || comp}
        </Button>
        <Button size="sm" variant="ghost" onClick={detach}>
          연결 해제
        </Button>
      </div>
      {componentPropsOf(doc.objects, comp).map(([cp, p]) => (
        <label key={cp} className="grid grid-cols-[88px_1fr] items-center gap-2 text-xs">
          {p.name as string}
          <select
            className={field}
            value={(inst[`props.${cp}`] as string) ?? (p.default as string)}
            onChange={(e) => set({ [`props.${cp}`]: e.target.value === p.default ? null : e.target.value })}
          >
            {optionsOf(p).map((o) => (
              <option key={o} value={o}>
                {o}
                {o === p.default ? " (기본)" : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
      <span className="text-xs font-semibold text-on-surface-muted">override</span>
      {targets(doc, comp).map((t) => (
        <Overrides key={t.path} doc={doc} inst={inst} t={t} set={set} />
      ))}
    </div>
  );
}

function Overrides({ doc, inst, t, set }: { doc: Doc; inst: Obj; t: Target; set: (p: Record<string, unknown>) => void }) {
  const key = (k: string) => `node.${t.path}.${k}`;
  const bound = Object.entries(t.o).filter(([k, v]) => !k.includes("@") && BIND_TYPE[k] && isBinding(v));
  const text = (k: string, label: string) => (
    <label key={k} className="grid grid-cols-[56px_1fr] items-center gap-1 text-xs">
      {label}
      <Input
        key={String(inst[key(k)])}
        size="sm"
        placeholder={(t.o[k] as string) ?? ""}
        defaultValue={(inst[key(k)] as string) ?? ""}
        onBlur={(e) => e.target.value !== (inst[key(k)] ?? "") && set({ [key(k)]: e.target.value || null })}
      />
    </label>
  );
  const rows = [
    t.o.type === "text" && text("content", "내용"),
    t.o.type === "image" && text("src", "src"),
    t.o.type === "image" && text("alt", "alt"),
    !t.root && (
      <label key="hidden" className="grid grid-cols-[56px_1fr] items-center gap-1 text-xs">
        숨김
        <select
          className={field}
          value={inst[key("hidden")] === undefined ? "" : String(inst[key("hidden")])}
          onChange={(e) => set({ [key("hidden")]: e.target.value === "" ? null : e.target.value === "true" })}
        >
          <option value="">원본({t.o.hidden === true ? "숨김" : "보임"})</option>
          <option value="true">숨김</option>
          <option value="false">보임</option>
        </select>
      </label>
    ),
    ...bound.map(([k, v]) => (
      <label key={k} className="grid grid-cols-[56px_1fr] items-center gap-1 text-xs">
        <span className="truncate" title={k}>
          {k.replace(/^style\./, "")}
        </span>
        <select
          className={field}
          value={(inst[key(k)] as { token: string } | undefined)?.token ?? ""}
          onChange={(e) => set({ [key(k)]: e.target.value ? { token: e.target.value } : null })}
        >
          <option value="">원본({doc.objects[(v as { token: string }).token]?.name as string})</option>
          {tokensOf(doc.objects)
            .filter(([, tk]) => tk.tokenType === BIND_TYPE[k])
            .map(([tid, tk]) => (
              <option key={tid} value={tid}>
                {tk.name as string}
              </option>
            ))}
        </select>
      </label>
    )),
  ].filter(Boolean);
  if (!rows.length) return null;
  const label = (t.o.name as string) || (t.o.type === "text" ? (t.o.content as string) : "") || t.o.type;
  return (
    <div className="flex flex-col gap-1" style={{ paddingLeft: t.depth * 10 }}>
      <span className="truncate text-xs text-on-surface-muted">{label}</span>
      {rows}
    </div>
  );
}
