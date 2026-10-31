"use client";

import { Button, Dialog, Icon, Input } from "@junhadex/core";
import { Trash2 } from "lucide";
import { useState, type ReactNode } from "react";
import { modifiersOf, resolveToken, TOKEN_TYPES, tokensOf, type Objects, type TokenType } from "@/model";
import { hex, ramp, toColor, type Color } from "./color";
import { fromDtcg, toDtcg } from "./dtcg";
import { apply, newId, useEditor } from "./store";

const DEFAULT: Record<TokenType, unknown> = {
  color: toColor("#000000"),
  dimension: { value: 16, unit: "px" },
  fontFamily: ["sans-serif"],
  fontWeight: 400,
  number: 0,
};

const set = (id: string, props: Record<string, unknown>) => apply({ op: "set", id, props });
const isRef = (v: unknown): v is { ref: string } => typeof v === "object" && v !== null && "ref" in v;
const field = "h-8 rounded border border-border bg-surface px-1 text-xs";

/** 토큰 값을 짧은 텍스트로 보여준다. */
function show(objects: Objects, v: unknown): ReactNode {
  if (v === undefined) return <span className="text-on-surface-muted">상속</span>;
  if (isRef(v)) return `→ ${objects[v.ref]?.name as string}`;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object" && v && "colorSpace" in v)
    return (
      <span className="flex items-center gap-1">
        <span className="inline-block size-3 rounded border border-border" style={{ background: hex(v as Color) }} />
        {hex(v as Color)}
      </span>
    );
  if (typeof v === "object" && v && "unit" in v) {
    const d = v as unknown as { value: number; unit: string };
    return `${d.value}${d.unit}`;
  }
  return String(v);
}

export function Tokens() {
  const open = useEditor((s) => s.tokensOpen);
  const error = useEditor((s) => s.error);
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => useEditor.setState({ tokensOpen: o })}
      title="디자인 토큰"
      className="w-[min(96vw,1200px)] max-w-none"
    >
      <div className="flex max-h-[75vh] flex-col gap-6 overflow-auto text-sm">
        {error && <p className="rounded bg-danger-subtle p-2 text-xs text-on-danger-subtle">{`${error.code}: ${error.message}`}</p>}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportDtcg}>
            DTCG 내보내기
          </Button>
          <Button size="sm" variant="secondary" onClick={() => importDtcg(setNote)}>
            DTCG 가져오기
          </Button>
          {note && <span className="text-xs text-on-surface-muted">{note}</span>}
        </div>
        <Modifiers />
        <Ramp />
        <Table sel={sel} onSelect={setSel} />
        {sel && <Detail id={sel} onSelect={setSel} />}
      </div>
    </Dialog>
  );
}

function exportDtcg() {
  const { tokens, resolver } = toDtcg(useEditor.getState().doc.objects);
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  useEditor.setState({
    tokensOpen: false,
    preview: {
      title: "DTCG 내보내기",
      parts: [
        { label: "tokens.json", lang: "json", code: json(tokens) },
        { label: "resolver.json", lang: "json", code: json(resolver) },
      ],
    },
  });
}

/** tokens.json과 선택적으로 resolver.json을 골라 한 트랜잭션으로 가져온다. resolver는 resolutionOrder가 있는 파일로 구분한다. */
function importDtcg(setNote: (s: string | null) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.multiple = true;
  input.hidden = true;
  document.body.append(input);
  input.onchange = async () => {
    input.remove();
    let files: Record<string, unknown>[];
    try {
      files = await Promise.all([...(input.files ?? [])].map(async (f) => JSON.parse(await f.text())));
    } catch {
      setNote("JSON 파일이 아니다");
      return;
    }
    const resolver = files.find((f) => "resolutionOrder" in f) ?? null;
    const tokens = files.find((f) => f !== resolver);
    if (!tokens) return setNote("tokens.json이 필요하다");
    const { ops, skipped } = fromDtcg(useEditor.getState().doc.objects, tokens, resolver, newId);
    if (!ops.length) return setNote("가져올 토큰이 없다");
    const r = apply(...ops);
    setNote(r.ok ? `토큰을 가져왔다${skipped.length ? `. 지원하지 않는 타입이라 건너뜀: ${skipped.join(", ")}` : ""}` : null);
  };
  input.click();
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-on-surface-muted">{title}</h3>
      {children}
    </section>
  );
}

function Modifiers() {
  const doc = useEditor((s) => s.doc);
  const [name, setName] = useState("");
  const [contexts, setContexts] = useState("");
  const [clone, setClone] = useState({ mod: "_mode", from: "light", to: "dark" });
  const mods = modifiersOf(doc.objects);
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const add = () => {
    const ctxs = list(contexts);
    const r = apply({ op: "create", id: newId(), type: "modifier", parent: null, props: { name, contexts: ctxs, default: ctxs[0] } });
    if (!r.ok) return;
    setName("");
    setContexts("");
  };
  const cloneCtx = () => {
    const ops = tokensOf(doc.objects)
      .filter(([, t]) => t.variesBy === clone.mod)
      .map(([id, t]) => ({ op: "set" as const, id, props: { [`value@ctx:${clone.to}`]: t[`value@ctx:${clone.from}`] ?? t.value } }));
    if (ops.length) apply(...ops);
  };
  const cmod = mods.find(([id]) => id === clone.mod)?.[1];
  return (
    <Section title="기준(modifier)">
      {mods.map(([id, m]) => (
        <div key={id} className="grid grid-cols-[140px_1fr_120px_auto] items-center gap-2">
          {id === "_mode" ? (
            <>
              <span>mode (기본 제공)</span>
              <span className="text-xs text-on-surface-muted">light, dark</span>
              <span className="text-xs text-on-surface-muted">기본 light</span>
              <span />
            </>
          ) : (
            <>
              <Input key={`n${m.name}`} size="sm" aria-label="modifier 이름" defaultValue={m.name as string} onBlur={(e) => e.target.value !== m.name && set(id, { name: e.target.value })} />
              <Input
                key={`c${(m.contexts as string[]).join()}`}
                size="sm"
                aria-label="컨텍스트(쉼표로 구분)"
                defaultValue={(m.contexts as string[]).join(", ")}
                onBlur={(e) => {
                  const next = list(e.target.value);
                  if (next.join() !== (m.contexts as string[]).join())
                    set(id, { contexts: next, ...(!next.includes(m.default as string) && { default: next[0] }) });
                }}
              />
              <select aria-label="기본 컨텍스트" className={field} value={m.default as string} onChange={(e) => set(id, { default: e.target.value })}>
                {(m.contexts as string[]).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" aria-label="modifier 삭제" onClick={() => apply({ op: "delete", id })}>
                <Icon node={Trash2} />
              </Button>
            </>
          )}
        </div>
      ))}
      <div className="grid grid-cols-[140px_1fr_auto] items-center gap-2">
        <Input size="sm" placeholder="이름 (예: palette)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input size="sm" placeholder="컨텍스트 (예: brand, mono)" value={contexts} onChange={(e) => setContexts(e.target.value)} />
        <Button size="sm" variant="secondary" onClick={add} disabled={!name || list(contexts).length < 2}>
          + 기준
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>컨텍스트 복제</span>
        <select aria-label="복제할 기준" className={field} value={clone.mod} onChange={(e) => {
          const m = mods.find(([id]) => id === e.target.value)![1];
          const c = m.contexts as string[];
          setClone({ mod: e.target.value, from: c[0], to: c[1] });
        }}>
          {mods.map(([id, m]) => (
            <option key={id} value={id}>
              {m.name as string}
            </option>
          ))}
        </select>
        <select aria-label="원본 컨텍스트" className={field} value={clone.from} onChange={(e) => setClone({ ...clone, from: e.target.value })}>
          {(cmod?.contexts as string[] | undefined)?.map((c) => <option key={c}>{c}</option>)}
        </select>
        <span>→</span>
        <select aria-label="대상 컨텍스트" className={field} value={clone.to} onChange={(e) => setClone({ ...clone, to: e.target.value })}>
          {(cmod?.contexts as string[] | undefined)?.map((c) => <option key={c}>{c}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={cloneCtx} disabled={clone.from === clone.to}>
          복제
        </Button>
      </div>
    </Section>
  );
}

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

function Ramp() {
  const doc = useEditor((s) => s.doc);
  const [prefix, setPrefix] = useState("color.blue");
  const [base, setBase] = useState("#3366ff");
  const generate = () => {
    const byName = new Map(tokensOf(doc.objects).map(([id, t]) => [t.name as string, id]));
    const ops = ramp(toColor(base), STEPS).map((value, i) => {
      const name = `${prefix}.${STEPS[i]}`;
      const id = byName.get(name);
      return id
        ? { op: "set" as const, id, props: { value } }
        : { op: "create" as const, id: newId(), type: "token" as const, parent: null, props: { name, tokenType: "color", value } };
    });
    apply(...ops);
  };
  const preview = ramp(toColor(base), STEPS);
  return (
    <Section title="램프 생성기 (OKLCH)">
      <div className="flex flex-wrap items-center gap-2">
        <Input size="sm" aria-label="토큰 이름 접두사" value={prefix} onChange={(e) => setPrefix(e.target.value)} className="w-40" />
        <input aria-label="기준색" type="color" value={base} onChange={(e) => setBase(e.target.value)} className="h-8 w-12 rounded border border-border" />
        <div className="flex">
          {preview.map((c, i) => (
            <span key={STEPS[i]} title={`${prefix}.${STEPS[i]} ${hex(c)}`} className="inline-block h-8 w-6" style={{ background: hex(c) }} />
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={generate} disabled={!prefix}>
          {STEPS.length}단계 생성
        </Button>
      </div>
    </Section>
  );
}

function Table({ sel, onSelect }: { sel: string | null; onSelect: (id: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const [name, setName] = useState("");
  const [type, setType] = useState<TokenType>("color");
  const mods = modifiersOf(doc.objects);
  const add = () => {
    const r = apply({ op: "create", id: newId(), type: "token", parent: null, props: { name, tokenType: type, value: DEFAULT[type] } });
    if (r.ok) setName("");
  };
  return (
    <Section title="토큰">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-on-surface-muted">
            <th className="p-1">이름</th>
            <th className="p-1">타입</th>
            <th className="p-1">기준</th>
            <th className="p-1">기본값</th>
            <th className="p-1">컨텍스트 값</th>
            <th className="p-1" />
          </tr>
        </thead>
        <tbody>
          {tokensOf(doc.objects).map(([id, t]) => {
            const mod = mods.find(([mid]) => mid === t.variesBy)?.[1];
            return (
              <tr key={id} className={`border-t border-border align-top ${id === sel ? "bg-brand-subtle" : ""}`}>
                <td className="p-1">
                  <div className="flex items-center gap-1">
                    <button type="button" className="text-xs text-on-surface-muted" title="선택" onClick={() => onSelect(id)}>
                      {isRef(t.value) ? "Alias" : "Raw"}
                    </button>
                    <Input key={`n${t.name}`} size="sm" aria-label="토큰 이름" defaultValue={t.name as string} onBlur={(e) => e.target.value !== t.name && set(id, { name: e.target.value })} />
                  </div>
                </td>
                <td className="p-1">{t.tokenType as string}</td>
                <td className="p-1">
                  <select aria-label="기준" className={field} value={(t.variesBy as string) ?? ""} onChange={(e) => set(id, { variesBy: e.target.value || null })}>
                    <option value="">없음</option>
                    {mods.map(([mid, m]) => (
                      <option key={mid} value={mid}>
                        {m.name as string}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-1">
                  <Value id={id} k="value" />
                </td>
                <td className="p-1">
                  <div className="flex flex-col gap-1">
                    {(mod?.contexts as string[] | undefined)?.map((c) => (
                      <div key={c} className="flex items-center gap-1">
                        <span className="w-12 text-on-surface-muted">{c}</span>
                        <Value id={id} k={`value@ctx:${c}`} />
                      </div>
                    ))}
                  </div>
                </td>
                <td className="p-1">
                  <Button size="sm" variant="ghost" aria-label="토큰 삭제" onClick={() => apply({ op: "delete", id })}>
                    <Icon node={Trash2} />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <Input size="sm" placeholder="이름 (예: color.action.primary)" value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
        <select aria-label="토큰 타입" className={field} value={type} onChange={(e) => setType(e.target.value as TokenType)}>
          {TOKEN_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={add} disabled={!name}>
          + 토큰
        </Button>
      </div>
    </Section>
  );
}

/** 토큰 값 칸. 상속(컨텍스트 칸만), 원시값, 같은 타입 토큰 참조 중에서 고른다. */
function Value({ id, k }: { id: string; k: string }) {
  const doc = useEditor((s) => s.doc);
  const t = doc.objects[id];
  const type = t.tokenType as TokenType;
  const v = t[k];
  const mode = v === undefined ? "" : isRef(v) ? v.ref : "raw";
  const refs = tokensOf(doc.objects).filter(([rid, r]) => rid !== id && r.tokenType === type);
  const put = (next: unknown) => set(id, { [k]: next });
  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="값 종류"
        className={field}
        value={mode}
        onChange={(e) => put(e.target.value === "" ? null : e.target.value === "raw" ? DEFAULT[type] : { ref: e.target.value })}
      >
        {k !== "value" && <option value="">상속</option>}
        <option value="raw">원시값</option>
        {refs.map(([rid, r]) => (
          <option key={rid} value={rid}>
            → {r.name as string}
          </option>
        ))}
      </select>
      {mode === "raw" && <Raw type={type} value={v} put={put} />}
    </div>
  );
}

function Raw({ type, value, put }: { type: TokenType; value: unknown; put: (v: unknown) => void }) {
  if (type === "color")
    return (
      <input
        key={hex(value as Color)}
        aria-label="색"
        type="color"
        defaultValue={hex(value as Color)}
        ref={(el) => {
          if (!el) return;
          // React의 onChange는 드래그 중에도 계속 발생하므로, 선택을 마칠 때 한 번 오는 네이티브 change를 쓴다.
          const commit = () => el.value !== hex(value as Color) && put(toColor(el.value));
          el.addEventListener("change", commit);
          return () => el.removeEventListener("change", commit);
        }}
        className="h-8 w-10 rounded border border-border"
      />
    );
  if (type === "fontFamily") {
    const s = (Array.isArray(value) ? value : [value]).join(", ");
    return (
      <input
        key={s}
        aria-label="글꼴 목록"
        defaultValue={s}
        onBlur={(e) => e.target.value !== s && put(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
        className={`${field} w-48`}
      />
    );
  }
  const n = type === "dimension" ? (value as { value: number }).value : (value as number);
  return (
    <input
      key={n}
      aria-label="값"
      type="number"
      defaultValue={n}
      onBlur={(e) => {
        const x = Number(e.target.value);
        if (x !== n) put(type === "dimension" ? { value: x, unit: "px" } : x);
      }}
      className={`${field} w-20`}
    />
  );
}

/** 선택한 토큰의 설명·폐기 표시와 모든 컨텍스트 조합의 최종 값. 칸을 누르면 값을 가진 원본 토큰으로 이동한다. */
function Detail({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const t = doc.objects[id];
  if (!t) return null;
  let combos: Record<string, string>[] = [{}];
  const mods = modifiersOf(doc.objects);
  for (const [mid, m] of mods) combos = combos.flatMap((c) => (m.contexts as string[]).map((ctx) => ({ ...c, [mid]: ctx })));
  return (
    <Section title={`${t.name as string} 상세`}>
      <div className="flex items-center gap-2">
        <Input
          key={`d${t.description}`}
          size="sm"
          aria-label="설명"
          placeholder="설명 (AI가 토큰을 고르는 근거)"
          defaultValue={(t.description as string) ?? ""}
          onBlur={(e) => e.target.value !== (t.description ?? "") && set(id, { description: e.target.value || null })}
          className="flex-1"
        />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={t.deprecated === true} onChange={(e) => set(id, { deprecated: e.target.checked || null })} />
          deprecated
        </label>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-on-surface-muted">
            {mods.map(([mid, m]) => (
              <th key={mid} className="p-1">
                {m.name as string}
              </th>
            ))}
            <th className="p-1">최종 값</th>
            <th className="p-1">원본 토큰</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((combo) => {
            const r = resolveToken(doc.objects, id, combo);
            return (
              <tr key={Object.values(combo).join()} className="border-t border-border">
                {mods.map(([mid]) => (
                  <td key={mid} className="p-1">
                    {combo[mid]}
                  </td>
                ))}
                <td className="p-1">{show(doc.objects, r.value)}</td>
                <td className="p-1">
                  <button type="button" className="text-brand underline" onClick={() => onSelect(r.source)}>
                    {doc.objects[r.source].name as string}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}
