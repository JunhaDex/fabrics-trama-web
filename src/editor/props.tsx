"use client";

import { Input, Select, Switch, Textarea } from "@junhadex/core";
import { useId, type ReactNode } from "react";
import { z } from "zod";
import { KEYS, type Doc, type NodeType } from "@/model";
import { localRect } from "./geometry";
import { apply, useEditor } from "./store";

type Dim = { value: number; unit: string };

const set = (id: string, props: Record<string, unknown>) => apply({ op: "set", id, props });
const round = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_TAG: Partial<Record<NodeType, string>> = { section: "section", container: "div", text: "p" };

function options(type: NodeType, key: string): string[] {
  const s = KEYS[type][key];
  return s instanceof z.ZodEnum ? (s.options as string[]) : [];
}

export function Props() {
  const doc = useEditor((s) => s.doc);
  const id = useEditor((s) => s.selected);
  if (!id) return <p className="p-3 text-sm text-on-surface-muted">노드를 선택하세요</p>;
  const o = doc.objects[id];
  const t = o.type;
  const has = (k: string) => Object.hasOwn(KEYS[t], k);
  const v = (k: string) => o[k];
  const parentMode = o.parent ? ((doc.objects[o.parent]["layout.mode"] as string) ?? "flex-column") : null;
  const mode = (v("layout.mode") as string) ?? "flex-column";
  const abs = v("position") === "absolute";

  return (
    <div key={id} className="flex flex-col gap-4 overflow-auto p-3 text-sm">
      <Group title="노드">
        <Text id={id} k="name" value={v("name")} label="이름" />
        {has("tag") && <Choice id={id} k="tag" value={v("tag")} opts={options(t, "tag")} def={DEFAULT_TAG[t]!} label="태그" />}
        <Toggle id={id} k="hidden" value={v("hidden")} label="숨김" />
        {t === "text" && <Text id={id} k="content" value={v("content")} label="내용" multiline />}
        {t === "image" && (
          <>
            <Text id={id} k="src" value={v("src")} label="src" />
            <Text id={id} k="alt" value={v("alt")} label="alt" />
            <Choice id={id} k="style.object-fit" value={v("style.object-fit")} opts={options(t, "style.object-fit")} def="fill" label="맞춤" />
          </>
        )}
      </Group>

      {t === "frame" && (
        <Group title="Frame">
          {(["boardX", "boardY", "previewWidth", "previewHeight", "minWidth"] as const).map((k) => (
            <Num key={k} id={id} k={k} value={v(k)} label={k} />
          ))}
          <Toggle id={id} k="safeArea" value={v("safeArea")} label="safe area" />
        </Group>
      )}

      {has("layout.mode") && (
        <Group title="레이아웃">
          <Choice id={id} k="layout.mode" value={v("layout.mode")} opts={options(t, "layout.mode")} def="flex-column" label="모드" />
          <Num id={id} k="layout.gap" value={v("layout.gap")} label="gap" dim />
          <Num id={id} k="layout.rowGap" value={v("layout.rowGap")} label="row gap" dim />
          <Choice id={id} k="layout.justify" value={v("layout.justify")} opts={options(t, "layout.justify")} def="start" label="justify" />
          <Choice id={id} k="layout.align" value={v("layout.align")} opts={options(t, "layout.align")} def="stretch" label="align" />
          {mode !== "grid" && <Toggle id={id} k="layout.wrap" value={v("layout.wrap")} label="wrap" />}
          {mode === "grid" && <Num id={id} k="layout.columns" value={v("layout.columns")} label="열 수" />}
          <Toggle id={id} k="layout.clip" value={v("layout.clip")} label="clip" />
        </Group>
      )}

      {parentMode && (
        <Group title="배치">
          <Row label="position">
            {(rid) => (
              <Select
                id={rid}
                size="sm"
                options={options(t, "position").map((p) => ({ value: p, label: p }))}
                value={abs ? "absolute" : "static"}
                onValueChange={(p) => toggleAbsolute(doc, id, p === "absolute")}
              />
            )}
          </Row>
          {abs ? (
            (["x", "y", "w", "h"] as const).map((k) => <Num key={k} id={id} k={k} value={v(k)} label={k} />)
          ) : (
            <>
              <Size id={id} k="size.width" value={v("size.width")} def={parentMode === "flex-row" ? "hug" : "fill"} label="폭" />
              <Size id={id} k="size.height" value={v("size.height")} def={parentMode === "flex-column" ? "hug" : "fill"} label="높이" />
              {(["minWidth", "maxWidth", "minHeight", "maxHeight"] as const).map((k) => (
                <Num key={k} id={id} k={`size.${k}`} value={v(`size.${k}`)} label={k} dim />
              ))}
              {parentMode === "grid" &&
                (["colStart", "colSpan", "rowStart", "rowSpan"] as const).map((k) => (
                  <Num key={k} id={id} k={`grid.${k}`} value={v(`grid.${k}`)} label={k} />
                ))}
            </>
          )}
        </Group>
      )}
    </div>
  );
}

function toggleAbsolute(doc: Doc, id: string, on: boolean) {
  if (!on) return void set(id, { position: null });
  const r = localRect(doc, id);
  set(id, { position: "absolute", ...(r && { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }) });
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold text-on-surface-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const rid = useId();
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
      <label htmlFor={rid} className="truncate text-xs">
        {label}
      </label>
      {children(rid)}
    </div>
  );
}

type FieldProps = { id: string; k: string; value: unknown; label: string };

function Text({ id, k, value, label, multiline }: FieldProps & { multiline?: boolean }) {
  const commit = (s: string) => s !== (value ?? "") && set(id, { [k]: s || null });
  return (
    <Row label={label}>
      {(rid) =>
        multiline ? (
          <Textarea key={String(value)} id={rid} size="sm" defaultValue={(value as string) ?? ""} onBlur={(e) => commit(e.target.value)} />
        ) : (
          <Input
            key={String(value)}
            id={rid}
            size="sm"
            defaultValue={(value as string) ?? ""}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        )
      }
    </Row>
  );
}

function Num({ id, k, value, label, dim }: FieldProps & { dim?: boolean }) {
  const n = dim ? (value as Dim | undefined)?.value : (value as number | undefined);
  const commit = (s: string) => {
    if (s === String(n ?? "")) return;
    const x = s === "" ? null : Number(s);
    set(id, { [k]: x === null ? null : dim ? { value: x, unit: "px" } : x });
  };
  return (
    <Row label={label}>
      {(rid) => (
        <Input
          key={String(n)}
          id={rid}
          size="sm"
          type="number"
          defaultValue={n ?? ""}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
    </Row>
  );
}

function Choice({ id, k, value, label, opts, def }: FieldProps & { opts: string[]; def: string }) {
  return (
    <Row label={label}>
      {(rid) => (
        <Select
          id={rid}
          size="sm"
          options={opts.map((o) => ({ value: o, label: o }))}
          value={(value as string) ?? def}
          onValueChange={(o) => set(id, { [k]: o === def ? null : o })}
        />
      )}
    </Row>
  );
}

function Toggle({ id, k, value, label }: FieldProps) {
  return (
    <Row label={label}>
      {(rid) => <Switch id={rid} checked={value === true} onCheckedChange={(on) => set(id, { [k]: on || null })} />}
    </Row>
  );
}

function Size({ id, k, value, label, def }: FieldProps & { def: "fill" | "hug" }) {
  const kind = typeof value === "object" && value ? "fixed" : ((value as string) ?? def);
  return (
    <>
      <Row label={label}>
        {(rid) => (
          <Select
            id={rid}
            size="sm"
            options={["fill", "hug", "fixed"].map((o) => ({ value: o, label: o }))}
            value={kind}
            onValueChange={(o) => set(id, { [k]: o === "fixed" ? { value: 100, unit: "px" } : o === def ? null : o })}
          />
        )}
      </Row>
      {kind === "fixed" && <Num id={id} k={k} value={value} label={`${label} (px)`} dim />}
    </>
  );
}
