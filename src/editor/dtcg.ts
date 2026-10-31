import { modifiersOf, TOKEN_TYPES, tokensOf, type Objects, type Op, type TokenType } from "@/model";
import { toColor } from "./color";

const EXT = "org.fabrics.trama";
type Json = Record<string, unknown>;

const isRef = (v: unknown): v is { ref: string } => typeof v === "object" && v !== null && "ref" in v;

/** 토큰 이름의 DTCG 경로. 다른 토큰의 그룹이기도 한 이름은 `$root` 토큰으로 둔다. */
function paths(objects: Objects): Map<string, string[]> {
  const names = tokensOf(objects).map(([, t]) => t.name as string);
  const groups = new Set(names.flatMap((n) => n.split(".").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("."))));
  return new Map(names.map((n) => [n, groups.has(n) ? [...n.split("."), "$root"] : n.split(".")]));
}

function put(tree: Json, path: string[], token: Json) {
  let cur = tree;
  for (const seg of path.slice(0, -1)) cur = (cur[seg] ??= {}) as Json;
  cur[path[path.length - 1]] = token;
}

/** 문서의 토큰과 modifier를 DTCG 2025.10 `tokens.json`과 `resolver.json`으로 바꾼다. 내부 ID는 `$extensions`에 넣는다. */
export function toDtcg(objects: Objects): { tokens: Json; resolver: Json } {
  const where = paths(objects);
  const ref = (v: unknown) => (isRef(v) ? `{${where.get(objects[v.ref].name as string)!.join(".")}}` : v);
  const mods = modifiersOf(objects);
  const tokens: Json = {};
  const contexts = new Map(mods.map(([id, m]) => [id, Object.fromEntries((m.contexts as string[]).map((c) => [c, {} as Json]))]));
  for (const [id, t] of tokensOf(objects)) {
    const path = where.get(t.name as string)!;
    const by = t.variesBy as string | undefined;
    put(tokens, path, {
      $type: t.tokenType,
      $value: ref(t.value),
      ...(t.description !== undefined && { $description: t.description }),
      ...(t.deprecated === true && { $deprecated: true }),
      $extensions: { [EXT]: { id, ...(by && { variesBy: objects[by]?.name ?? "mode" }) } },
    });
    if (!by) continue;
    for (const [k, v] of Object.entries(t))
      if (k.startsWith("value@ctx:")) put(contexts.get(by)![k.slice(10)], path, { $type: t.tokenType, $value: ref(v) });
  }
  const resolver: Json = {
    $schema: "https://www.designtokens.org/schemas/2025.10/resolver.json",
    name: "trama",
    version: "2025.10",
    sets: { base: { sources: [{ $ref: "tokens.json" }] } },
    modifiers: Object.fromEntries(
      mods.map(([id, m]) => [
        m.name,
        {
          contexts: Object.fromEntries(Object.entries(contexts.get(id)!).map(([c, tree]) => [c, Object.keys(tree).length ? [tree] : []])),
          default: m.default,
        },
      ]),
    ),
    resolutionOrder: [{ $ref: "#/sets/base" }, ...mods.map(([, m]) => ({ $ref: `#/modifiers/${m.name}` }))],
  };
  return { tokens, resolver };
}

const WEIGHT: Record<string, number> = {
  thin: 100, hairline: 100, "extra-light": 200, "ultra-light": 200, light: 300, normal: 400, regular: 400, book: 400,
  medium: 500, "semi-bold": 600, "demi-bold": 600, bold: 700, "extra-bold": 800, "ultra-bold": 800, black: 900, heavy: 900,
  "extra-black": 950, "ultra-black": 950,
};

const PLACEHOLDER: Record<TokenType, unknown> = {
  color: { colorSpace: "srgb", components: [0, 0, 0] },
  dimension: { value: 0, unit: "px" },
  fontFamily: "sans-serif",
  fontWeight: 400,
  number: 0,
};

type Flat = { name: string; type: string | undefined; token: Json };

/** DTCG 토큰 트리를 이름과 타입(그룹 `$type` 상속 포함)이 붙은 목록으로 편다. */
function flatten(tree: Json, prefix: string[] = [], inherited?: string): Flat[] {
  const type = (tree.$type as string | undefined) ?? inherited;
  if ("$value" in tree) return [{ name: prefix.filter((s) => s !== "$root").join("."), type, token: tree }];
  return Object.entries(tree).flatMap(([k, v]) =>
    (k.startsWith("$") && k !== "$root") || typeof v !== "object" || v === null ? [] : flatten(v as Json, [...prefix, k], type),
  );
}

export type Imported = { ops: Op[]; skipped: string[] };

/**
 * DTCG `tokens.json`(과 선택적으로 `resolver.json`)을 문서에 적용할 연산 목록으로 바꾼다.
 * 같은 내부 ID 또는 같은 이름의 토큰은 갱신하고, 지원하지 않는 타입의 토큰은 건너뛴다.
 */
export function fromDtcg(objects: Objects, tokensJson: Json, resolverJson: Json | null, newId: () => string): Imported {
  const flat = flatten(tokensJson);
  const skipped = flat.filter((f) => !(TOKEN_TYPES as readonly string[]).includes(f.type ?? "")).map((f) => `${f.name} (${f.type ?? "타입 없음"})`);
  const items = flat.filter((f) => (TOKEN_TYPES as readonly string[]).includes(f.type ?? ""));
  const existing = new Map(tokensOf(objects).map(([id, t]) => [t.name as string, id]));
  const ids = new Map(
    items.map((f) => {
      const ext = (f.token.$extensions as Json | undefined)?.[EXT] as Json | undefined;
      const id = ext?.id as string | undefined;
      return [f.name, id && (!objects[id] || objects[id].type === "token") ? id : (existing.get(f.name) ?? newId())];
    }),
  );
  const value = (type: TokenType, v: unknown): unknown => {
    if (typeof v === "string" && /^\{.+\}$/.test(v)) {
      const id = ids.get(v.slice(1, -1).replace(/\.\$root$/, ""));
      return id ? { ref: id } : v;
    }
    if (type === "color" && typeof v === "object" && v !== null) {
      const c = v as Json;
      return c.colorSpace === "srgb" ? { colorSpace: "srgb", components: c.components, ...(c.alpha !== undefined && { alpha: c.alpha }) } : c.hex ? toColor(c.hex as string) : c;
    }
    if (type === "fontWeight" && typeof v === "string") return WEIGHT[v] ?? v;
    return v;
  };

  const ops: Op[] = [];
  // 참조 대상이 먼저 있어야 하므로, 새 토큰은 임시 값으로 모두 만든 뒤 실제 값을 쓴다.
  for (const f of items)
    if (!objects[ids.get(f.name)!])
      ops.push({ op: "create", id: ids.get(f.name)!, type: "token", parent: null, props: { name: f.name, tokenType: f.type, value: PLACEHOLDER[f.type as TokenType] } });
  const fix = new Map<string, Record<string, unknown>>();
  const props = (name: string) => fix.get(name) ?? fix.set(name, {}).get(name)!;
  for (const f of items) {
    const p = props(f.name);
    Object.assign(p, { name: f.name, tokenType: f.type, value: value(f.type as TokenType, f.token.$value) });
    if (typeof f.token.$description === "string") p.description = f.token.$description;
    if (f.token.$deprecated !== undefined) p.deprecated = f.token.$deprecated !== false;
  }

  const modIds = new Map(modifiersOf(objects).map(([id, m]) => [m.name as string, id]));
  const mods = (resolverJson?.modifiers ?? {}) as Record<string, { contexts: Record<string, unknown[]>; default?: string }>;
  for (const [name, m] of Object.entries(mods)) {
    const ctxs = Object.keys(m.contexts);
    if (!modIds.has(name)) {
      const id = newId();
      modIds.set(name, id);
      ops.unshift({ op: "create", id, type: "modifier", parent: null, props: { name, contexts: ctxs, default: m.default ?? ctxs[0] } });
    }
    for (const [ctx, sources] of Object.entries(m.contexts))
      for (const src of sources) {
        if (typeof src !== "object" || src === null || "$ref" in src) continue;
        for (const f of flatten(src as Json)) {
          const item = items.find((i) => i.name === f.name);
          if (!item) continue;
          const p = props(f.name);
          p.variesBy = modIds.get(name);
          p[`value@ctx:${ctx}`] = value(item.type as TokenType, f.token.$value);
        }
      }
  }
  for (const f of items) {
    const by = ((f.token.$extensions as Json | undefined)?.[EXT] as Json | undefined)?.variesBy as string | undefined;
    if (by && modIds.has(by) && !fix.get(f.name)!.variesBy) fix.get(f.name)!.variesBy = modIds.get(by);
  }
  for (const [name, p] of fix) ops.push({ op: "set", id: ids.get(name)!, props: p });
  return { ops, skipped };
}
