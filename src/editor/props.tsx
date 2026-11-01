"use client";

import { Button, Icon, Input, Select, Switch, Textarea } from "@junhadex/core";
import { RotateCcw, Trash2, X } from "lucide";
import { useId, type ReactNode } from "react";
import { z } from "zod";
import { BIND_TYPE, breakpointsOf, frameOf, KEYS, parseKey, tokensOf, type Doc, type NodeType } from "@/model";
import { activeBp, context, effective, overridden, write } from "./bp";
import { ComponentProps, InstancePanel, toComponent } from "./component";
import { hex, toColor, type Color } from "./color";
import { localRect } from "./geometry";
import { apply, newId, useEditor } from "./store";

type Dim = { value: number; unit: string };
const isBinding = (v: unknown): v is { token: string } => typeof v === "object" && v !== null && "token" in v;

const set = (id: string, props: Record<string, unknown>) => apply({ op: "set", id, props });
const round = (n: number) => Math.round(n * 100) / 100;
const DEFAULT_TAG: Partial<Record<NodeType, string>> = { component: "div", section: "section", container: "div", text: "p" };

/** 편집 조건을 사람이 읽는 이름으로 바꾼다. 예: `tone=danger · hover`, `컨테이너 ≥ 480px`. */
function describe(doc: Doc, target: string): string {
  const k = parseKey(`x${target}`)!;
  if (k.cq !== undefined) return `컨테이너 ≥ ${k.cq}px`;
  return [k.var && `${doc.objects[k.var[0]]?.name as string}=${k.var[1]}`, k.state].filter(Boolean).join(" · ");
}

function options(type: NodeType, key: string): string[] {
  const s = KEYS[type][key];
  return s instanceof z.ZodEnum ? (s.options as string[]) : [];
}

export function Props() {
  const doc = useEditor((s) => s.doc);
  const id = useEditor((s) => s.selected);
  useEditor((s) => s.comp);
  if (!id) return <p className="p-3 text-sm text-on-surface-muted">노드를 선택하세요</p>;
  const o = effective(doc, id);
  const t = o.type as NodeType;
  const has = (k: string) => Object.hasOwn(KEYS[t], k);
  const v = (k: string) => o[k];
  const f = (k: string) => ({ id, k, value: o[k], reset: overridden(doc, id, k) ? () => write(id, k, null) : undefined });
  const parentMode = o.parent ? ((effective(doc, o.parent)["layout.mode"] as string) ?? "flex-column") : null;
  const root = frameOf(doc.objects, id);
  const bp = doc.objects[root].type === "frame" ? activeBp(doc, root) : null;
  const target = doc.objects[root].type === "component" ? context(doc, root).target : null;
  const mode = (v("layout.mode") as string) ?? "flex-column";
  const abs = v("position") === "absolute";

  return (
    <div key={id} className="flex flex-col gap-4 overflow-auto p-3 text-sm">
      {bp && (
        <p className="rounded bg-brand-subtle p-2 text-xs text-on-brand-subtle">
          현재 BP: {(doc.objects[bp].name as string) || "BP"} ({doc.objects[bp].minWidth as number}px 이상). 레이아웃·스타일·숨김은 이 BP의
          override로 저장되고, 이름·태그·내용·position 편집은 모든 BP에 적용됩니다.
        </p>
      )}
      {target && (
        <p className="rounded bg-brand-subtle p-2 text-xs text-on-brand-subtle">
          편집 조건: {describe(doc, target)}. {target.includes("@state") ? "스타일" : "레이아웃·스타일·숨김"}은
          이 조건의 override로 저장되고, 그 밖의 편집은 원본 base에 적용됩니다.
        </p>
      )}
      <Group title="노드">
        <Text {...f("name")} label="이름" />
        {has("tag") && <Choice {...f("tag")} opts={options(t, "tag")} def={DEFAULT_TAG[t]!} label="태그" />}
        <Toggle {...f("hidden")} label="숨김" />
        {t === "text" && <Text {...f("content")} label="내용" multiline />}
        {t === "container" && (
          <Button size="sm" variant="secondary" onClick={() => toComponent(doc, id)}>
            컴포넌트로 만들기
          </Button>
        )}
        {t === "image" && (
          <>
            <Text {...f("src")} label="src" />
            <Text {...f("alt")} label="alt" />
            <Choice {...f("style.object-fit")} opts={options(t, "style.object-fit")} def="fill" label="맞춤" />
          </>
        )}
      </Group>

      {t === "instance" && (
        <Group title="인스턴스">
          <InstancePanel doc={doc} id={id} />
        </Group>
      )}

      {t === "component" && (
        <Group title="컴포넌트">
          {(["boardX", "boardY", "previewWidth", "previewHeight"] as const).map((k) => (
            <Num key={k} {...f(k)} label={k} />
          ))}
          <ComponentProps doc={doc} comp={id} />
        </Group>
      )}

      {t !== "instance" && <Group title="스타일">
        {has("style.background-color") && <ColorField {...f("style.background-color")} label="배경" />}
        {has("style.color") && (
          <>
            <ColorField {...f("style.color")} label="글자색" />
            <FontField {...f("style.font-family")} label="글꼴" />
            <Num {...f("style.font-size")} label="글자 크기" dim />
            <Choice {...f("style.font-weight")} opts={WEIGHTS} def="400" label="굵기" num />
          </>
        )}
        {has("style.padding-top") && (
          <>
            {(["top", "right", "bottom", "left"] as const).map((s) => (
              <Num key={s} {...f(`style.padding-${s}`)} label={`padding ${s}`} dim />
            ))}
            <Num {...f("style.border-width")} label="테두리 두께" dim />
            <Choice {...f("style.border-style")} opts={options(t, "style.border-style")} def="none" label="테두리 모양" />
            <ColorField {...f("style.border-color")} label="테두리 색" />
            <Num {...f("style.border-radius")} label="모서리" dim />
          </>
        )}
      </Group>}

      {t === "frame" && (
        <Group title="Frame">
          {(["boardX", "boardY", "previewWidth", "previewHeight", "minWidth"] as const).map((k) => (
            <Num key={k} {...f(k)} label={k} />
          ))}
          <Toggle {...f("safeArea")} label="safe area" />
          <Breakpoints doc={doc} frame={id} />
        </Group>
      )}

      {has("layout.mode") && (
        <Group title="레이아웃">
          <Choice {...f("layout.mode")} opts={options(t, "layout.mode")} def="flex-column" label="모드" />
          <Num {...f("layout.gap")} label="gap" dim />
          <Num {...f("layout.rowGap")} label="row gap" dim />
          <Choice {...f("layout.justify")} opts={options(t, "layout.justify")} def="start" label="justify" />
          <Choice {...f("layout.align")} opts={options(t, "layout.align")} def="stretch" label="align" />
          {mode !== "grid" && <Toggle {...f("layout.wrap")} label="wrap" />}
          {mode === "grid" && <Num {...f("layout.columns")} label="열 수" />}
          <Toggle {...f("layout.clip")} label="clip" />
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
            (["x", "y", "w", "h"] as const).map((k) => <Num key={k} {...f(k)} label={k} />)
          ) : (
            <>
              <Size {...f("size.width")} def={parentMode === "flex-row" ? "hug" : "fill"} label="폭" />
              <Size {...f("size.height")} def={parentMode === "flex-column" ? "hug" : "fill"} label="높이" />
              {(["minWidth", "maxWidth", "minHeight", "maxHeight"] as const).map((k) => (
                <Num key={k} {...f(`size.${k}`)} label={k} dim />
              ))}
              {parentMode === "grid" &&
                (["colStart", "colSpan", "rowStart", "rowSpan"] as const).map((k) => (
                  <Num key={k} {...f(`grid.${k}`)} label={k} />
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

type RowProps = { label: string; reset?: () => void; bind?: { id: string; k: string }; children: (id: string) => ReactNode };

function Row({ label, reset, bind, children }: RowProps) {
  const rid = useId();
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <label htmlFor={rid} className={`truncate text-xs ${reset ? "font-semibold text-brand" : ""}`}>
          {label}
        </label>
        {reset && (
          <button type="button" aria-label={`${label} override 해제`} title="이 BP의 override 해제" onClick={reset} className="text-brand">
            <Icon node={RotateCcw} size={12} />
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <div className="min-w-0 flex-1">{children(rid)}</div>
        {bind && BIND_TYPE[bind.k] && <TokenSelect {...bind} label={label} />}
      </div>
    </div>
  );
}

function TokenSelect({ id, k, label }: { id: string; k: string; label: string }) {
  const doc = useEditor((s) => s.doc);
  const opts = tokensOf(doc.objects).filter(([, t]) => t.tokenType === BIND_TYPE[k]);
  if (!opts.length) return null;
  return (
    <select
      aria-label={`${label} 토큰`}
      value=""
      onChange={(e) => e.target.value && write(id, k, { token: e.target.value })}
      className="h-8 w-16 rounded border border-border bg-surface px-1 text-xs"
    >
      <option value="">토큰</option>
      {opts.map(([tid, t]) => (
        <option key={tid} value={tid}>
          {t.name as string}
        </option>
      ))}
    </select>
  );
}

/** 토큰이 바인딩된 필드. 토큰 이름과 바인딩 해제 버튼을 보여준다. */
function Bound({ id, k, value, label, reset }: FieldProps) {
  const doc = useEditor((s) => s.doc);
  const name = (doc.objects[(value as { token: string }).token]?.name as string) ?? "?";
  return (
    <Row label={label} reset={reset}>
      {(rid) => (
        <div className="flex items-center gap-1">
          <span id={rid} className="truncate rounded bg-brand-subtle px-2 py-1 text-xs text-on-brand-subtle">
            {name}
          </span>
          <Button size="sm" variant="ghost" aria-label={`${label} 토큰 해제`} onClick={() => write(id, k, null)}>
            <Icon node={X} />
          </Button>
        </div>
      )}
    </Row>
  );
}

function FontField(p: FieldProps) {
  if (isBinding(p.value)) return <Bound {...p} />;
  return (
    <Row label={p.label} reset={p.reset} bind={{ id: p.id, k: p.k }}>
      {(rid) => (
        <span id={rid} className="text-xs text-on-surface-muted">
          기본값
        </span>
      )}
    </Row>
  );
}

type FieldProps = { id: string; k: string; value: unknown; label: string; reset?: () => void };

function Text({ id, k, value, label, reset, multiline }: FieldProps & { multiline?: boolean }) {
  const commit = (s: string) => s !== (value ?? "") && write(id, k, s || null);
  return (
    <Row label={label} reset={reset}>
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

function Num({ id, k, value, label, reset, dim }: FieldProps & { dim?: boolean }) {
  if (isBinding(value)) return <Bound id={id} k={k} value={value} label={label} reset={reset} />;
  const n = dim ? (value as Dim | undefined)?.value : (value as number | undefined);
  const commit = (s: string) => {
    if (s === String(n ?? "")) return;
    const x = s === "" ? null : Number(s);
    write(id, k, x === null ? null : dim ? { value: x, unit: "px" } : x);
  };
  return (
    <Row label={label} reset={reset} bind={{ id, k }}>
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

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

function ColorField({ id, k, value, label, reset }: FieldProps) {
  if (isBinding(value)) return <Bound id={id} k={k} value={value} label={label} reset={reset} />;
  const c = value as Color | undefined;
  return (
    <Row label={label} reset={reset} bind={{ id, k }}>
      {(rid) => (
        <div className="flex items-center gap-2">
          <input
            key={c ? hex(c) : "none"}
            id={rid}
            type="color"
            defaultValue={c ? hex(c) : "#000000"}
            ref={(el) => {
              if (!el) return;
              // React의 onChange는 드래그 중에도 계속 발생하므로, 선택을 마칠 때 한 번 오는 네이티브 change를 쓴다.
              const commit = () => (!c || el.value !== hex(c)) && write(id, k, toColor(el.value));
              el.addEventListener("change", commit);
              return () => el.removeEventListener("change", commit);
            }}
            className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
          />
          <span className="flex-1 text-xs text-on-surface-muted">{c ? hex(c) : "없음"}</span>
          {c && (
            <Button size="sm" variant="ghost" aria-label={`${label} 지우기`} onClick={() => write(id, k, null)}>
              <Icon node={X} />
            </Button>
          )}
        </div>
      )}
    </Row>
  );
}

function Choice({ id, k, value, label, reset, opts, def, num }: FieldProps & { opts: string[]; def: string; num?: boolean }) {
  if (isBinding(value)) return <Bound id={id} k={k} value={value} label={label} reset={reset} />;
  return (
    <Row label={label} reset={reset} bind={{ id, k }}>
      {(rid) => (
        <Select
          id={rid}
          size="sm"
          options={opts.map((o) => ({ value: o, label: o }))}
          value={value === undefined ? def : String(value)}
          onValueChange={(o) => write(id, k, num ? Number(o) : o, num ? Number(def) : def)}
        />
      )}
    </Row>
  );
}

function Toggle({ id, k, value, label, reset }: FieldProps) {
  return (
    <Row label={label} reset={reset}>
      {(rid) => <Switch id={rid} checked={value === true} onCheckedChange={(on) => write(id, k, on, false)} />}
    </Row>
  );
}

function Size({ id, k, value, label, reset, def }: FieldProps & { def: "fill" | "hug" }) {
  if (isBinding(value)) return <Bound id={id} k={k} value={value} label={label} reset={reset} />;
  const kind = typeof value === "object" && value ? "fixed" : ((value as string) ?? def);
  return (
    <>
      <Row label={label} reset={reset} bind={{ id, k }}>
        {(rid) => (
          <Select
            id={rid}
            size="sm"
            options={["fill", "hug", "fixed"].map((o) => ({ value: o, label: o }))}
            value={kind}
            onValueChange={(o) => write(id, k, o === "fixed" ? { value: 100, unit: "px" } : o, def)}
          />
        )}
      </Row>
      {kind === "fixed" && <Num id={id} k={k} value={value} label={`${label} (px)`} dim />}
    </>
  );
}

function Breakpoints({ doc, frame }: { doc: Doc; frame: string }) {
  const bps = breakpointsOf(doc.objects, frame);
  const add = () => {
    const last = (bps.at(-1)?.[1].minWidth as number | undefined) ?? (doc.objects[frame].minWidth as number) ?? 320;
    apply({ op: "create", id: newId(), type: "breakpoint", parent: frame, props: { name: "BP", minWidth: last + 256 } });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-on-surface-muted">Breakpoint</span>
        <Button size="sm" variant="ghost" onClick={add}>
          + BP
        </Button>
      </div>
      {bps.map(([bid, bp]) => (
        <div key={bid} className="grid grid-cols-[1fr_88px_auto] items-center gap-1">
          <Input
            key={`n${bp.name}`}
            size="sm"
            aria-label="BP 이름"
            defaultValue={(bp.name as string) ?? ""}
            onBlur={(e) => e.target.value !== (bp.name ?? "") && set(bid, { name: e.target.value || null })}
          />
          <Input
            key={`w${bp.minWidth}`}
            size="sm"
            type="number"
            aria-label="BP 최소 폭"
            defaultValue={bp.minWidth as number}
            onBlur={(e) => Number(e.target.value) !== bp.minWidth && set(bid, { minWidth: Number(e.target.value) })}
          />
          <Button size="sm" variant="ghost" aria-label="BP 삭제" onClick={() => apply({ op: "delete", id: bid })}>
            <Icon node={Trash2} />
          </Button>
        </div>
      ))}
    </div>
  );
}
