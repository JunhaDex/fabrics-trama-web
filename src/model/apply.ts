import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import {
  BIND_TYPE,
  bpAllowed,
  KEYS,
  NODE_TYPES,
  PARENTS,
  TOKEN_VALUE,
  TokenRef,
  Tx,
  type ObjType,
  type Op,
  type Placement,
  type TokenType,
} from "./schema";

export type Obj = { type: ObjType; parent: string | null; order?: string } & Record<string, unknown>;
export type Objects = Record<string, Obj>;
export type Doc = { schemaVersion: 1; objects: Objects };

export type ErrorCode =
  | "SCHEMA_INVALID"
  | "UNKNOWN_OBJECT"
  | "ID_CONFLICT"
  | "TYPE_IMMUTABLE"
  | "INVALID_PARENT"
  | "TREE_CYCLE"
  | "KEY_INVALID"
  | "KEY_NOT_ALLOWED"
  | "CONDITION_NOT_ALLOWED"
  | "CONDITION_TARGET_MISSING"
  | "VALUE_INVALID"
  | "TOKEN_TYPE_MISMATCH"
  | "TOKEN_CYCLE"
  | "TOKEN_IN_USE"
  | "NAME_CONFLICT"
  | "STRUCTURE_LOCKED";

export type Warning = { code: "TOKEN_DEPRECATED" | "RAW_TOKEN_BOUND"; id: string; key: string };

export type OpError = {
  code: ErrorCode;
  opIndex: number | null;
  id: string | null;
  key: string | null;
  message: string;
};

export type Change = { id: string; key: string; before: unknown; after: unknown };

export type Result = { ok: true; doc: Doc; changes: Change[]; warnings: Warning[] } | { ok: false; error: OpError };

class Reject extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly id: string | null,
    readonly key: string | null,
    message: string,
  ) {
    super(message);
  }
}

/** 트랜잭션을 검증해 적용한 새 문서를 돌려준다. 연산 하나라도 실패하면 전부 거부하며, 입력 doc은 바꾸지 않는다. */
export function applyOps(doc: Doc, input: unknown): Result {
  const tx = Tx.safeParse(input);
  if (!tx.success) {
    const [head, index] = tx.error.issues[0].path;
    return {
      ok: false,
      error: {
        code: "SCHEMA_INVALID",
        opIndex: head === "ops" && typeof index === "number" ? index : null,
        id: null,
        key: null,
        message: z.prettifyError(tx.error),
      },
    };
  }
  const objects = { ...doc.objects };
  const ops = tx.data.ops;
  const warnings: Warning[] = [];
  for (let i = 0; i < ops.length; i++) {
    try {
      apply(objects, ops[i], warnings);
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      return { ok: false, error: { code: e.code, opIndex: i, id: e.id, key: e.key, message: e.message } };
    }
  }
  return { ok: true, doc: { ...doc, objects }, changes: diff(doc.objects, objects), warnings };
}

/**
 * changes를 적용 전 값으로 되돌린 새 문서와, 다시 적용할 때 쓸 변경 목록을 돌려준다.
 * 현재 값이 changes의 적용 후 값과 다른 키(이후 다른 참여자가 바꾼 키)는 건너뛴다.
 */
export function revert(doc: Doc, changes: Change[]): { doc: Doc; changes: Change[] } {
  const objects = { ...doc.objects };
  for (const c of changes) {
    const cur = objects[c.id];
    if (!same(cur?.[c.key], c.after)) continue;
    const next = { ...cur } as Obj;
    if (c.before === undefined) delete next[c.key];
    else next[c.key] = c.before;
    if (Object.keys(next).length) objects[c.id] = next;
    else delete objects[c.id];
  }
  return { doc: { ...doc, objects }, changes: diff(doc.objects, objects) };
}

// 값은 JSON이며 같은 코드 경로에서 만들어져 키 순서가 같으므로 직렬화 비교로 충분하다.
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function diff(prev: Objects, next: Objects): Change[] {
  const out: Change[] = [];
  for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const a = prev[id];
    const b = next[id];
    if (a === b) continue;
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]))
      if (!same(a?.[key], b?.[key])) out.push({ id, key, before: a?.[key], after: b?.[key] });
  }
  return out;
}

/** parent의 자식 노드를 (order, id) 사전순으로 돌려준다. parent가 null이면 보드 위 Frame이다. breakpoint는 포함하지 않는다. */
export function childrenOf(objects: Objects, parent: string | null): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.parent === parent && isNode(o))
    .sort(([a, x], [b, y]) => (x.order !== y.order ? (x.order! < y.order! ? -1 : 1) : a < b ? -1 : 1));
}

const isNode = (o: Obj) => (NODE_TYPES as readonly string[]).includes(o.type);

/** 기본 제공 modifier. 문서에 저장하지 않으며 항상 있다. */
export const MODE: Obj = { type: "modifier", parent: null, name: "mode", contexts: ["light", "dark"], default: "light" };

/** modifier를 `_mode` 먼저, 이후 이름순으로 돌려준다. */
export function modifiersOf(objects: Objects): [string, Obj][] {
  const user = Object.entries(objects)
    .filter(([, o]) => o.type === "modifier")
    .sort(([, a], [, b]) => ((a.name as string) < (b.name as string) ? -1 : 1));
  return [["_mode", MODE], ...user];
}

/** 토큰을 이름순으로 돌려준다. */
export function tokensOf(objects: Objects): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.type === "token")
    .sort(([, a], [, b]) => ((a.name as string) < (b.name as string) ? -1 : 1));
}

/** 토큰이 컨텍스트 조합(modifier ID → 컨텍스트)에서 갖는 값. 원시값이거나 `{ ref }`다. */
export function tokenValueAt(token: Obj, combo: Record<string, string>): unknown {
  const by = token.variesBy as string | undefined;
  const ctx = by ? combo[by] : undefined;
  return (ctx !== undefined ? token[`value@ctx:${ctx}`] : undefined) ?? token.value;
}

const modifierOf = (o: Objects, id: string): Obj | undefined => (id === "_mode" ? MODE : o[id]?.type === "modifier" ? o[id] : undefined);

/** Frame의 breakpoint를 minWidth 오름차순으로 돌려준다. */
export function breakpointsOf(objects: Objects, frame: string): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.parent === frame && o.type === "breakpoint")
    .sort(([, x], [, y]) => (x.minWidth as number) - (y.minWidth as number));
}

/** 객체가 속한 Frame의 ID. */
export function frameOf(objects: Objects, id: string): string {
  let cur = id;
  while (objects[cur].parent !== null) cur = objects[cur].parent!;
  return cur;
}

function apply(o: Objects, op: Op, warnings: Warning[]) {
  if (op.id === "_mode" && op.op !== "create") throw new Reject("STRUCTURE_LOCKED", op.id, null, "기본 제공 modifier는 바꿀 수 없다");
  const tokenish = (t: ObjType) => t === "token" || t === "modifier";
  switch (op.op) {
    case "create": {
      if (Object.hasOwn(o, op.id) || op.id === "mode" || op.id.startsWith("_"))
        throw new Reject("ID_CONFLICT", op.id, null, "이미 있거나 예약된 ID다");
      const node = (NODE_TYPES as readonly string[]).includes(op.type);
      if (node !== (op.placement !== undefined))
        throw new Reject("VALUE_INVALID", op.id, "placement", "노드는 placement가 필요하고, 노드가 아닌 객체는 placement를 받지 않는다");
      checkParent(o, op.type, op.id, op.parent);
      const props = op.props ?? {};
      checkProps(o, op.type, op.id, op.parent === null ? op.id : frameOf(o, op.parent), props, warnings);
      const obj: Obj = { type: op.type, parent: op.parent };
      if (node) obj.order = orderAt(o, op.parent, op.placement!, op.id);
      for (const [k, v] of Object.entries(props)) if (v !== null) obj[k] = v;
      o[op.id] = obj;
      if (op.type === "breakpoint") checkBreakpoints(o, op.parent!, op.id);
      if (tokenish(op.type)) checkTokens(o);
      return;
    }
    case "set": {
      const obj = get(o, op.id);
      checkProps(o, obj.type, op.id, frameOf(o, op.id), op.props, warnings);
      const next = { ...obj };
      // variesBy가 바뀌면 이전 기준의 @ctx 값은 의미가 없으므로 지운다. 같은 연산에서 준 @ctx 값은 아래에서 다시 쓴다.
      if (obj.type === "token" && "variesBy" in op.props && op.props.variesBy !== obj.variesBy)
        for (const k of Object.keys(next)) if (k.startsWith("value@ctx:")) delete next[k];
      for (const [k, v] of Object.entries(op.props)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      o[op.id] = next;
      if (obj.type === "breakpoint") checkBreakpoints(o, obj.parent!, op.id);
      else if (obj.type === "frame" && "minWidth" in op.props) checkBreakpoints(o, op.id, op.id);
      if (obj.type === "modifier" && "contexts" in op.props) dropContexts(o, op.id);
      if (tokenish(obj.type)) checkTokens(o);
      return;
    }
    case "move": {
      const obj = get(o, op.id);
      if (!isNode(obj)) throw new Reject("INVALID_PARENT", op.id, null, `${obj.type}는 옮길 수 없다`);
      if (op.placement === undefined) throw new Reject("VALUE_INVALID", op.id, "placement", "move에는 placement가 필요하다");
      checkParent(o, obj.type, op.id, op.parent);
      const from = frameOf(o, op.id);
      o[op.id] = { ...obj, parent: op.parent, order: orderAt(o, op.parent, op.placement, op.id) };
      if (frameOf(o, op.id) !== from) for (const id of subtree(o, op.id)) strip(o, id, () => true);
      return;
    }
    case "delete": {
      const obj = get(o, op.id);
      if (obj.type === "token") checkUnused(o, op.id);
      if (obj.type === "modifier" && Object.values(o).some((t) => t.type === "token" && t.variesBy === op.id))
        throw new Reject("TOKEN_IN_USE", op.id, null, "이 modifier에 따라 달라지는 토큰이 있다");
      for (const id of subtree(o, op.id)) delete o[id];
      if (obj.type === "breakpoint") for (const id of Object.keys(o)) strip(o, id, (bp) => bp === op.id);
      return;
    }
  }
}

function subtree(o: Objects, root: string): string[] {
  const kids = new Map<string | null, string[]>();
  for (const [id, x] of Object.entries(o)) {
    const list = kids.get(x.parent);
    if (list) list.push(id);
    else kids.set(x.parent, [id]);
  }
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** match가 참인 BP를 가리키는 `@bp:` 키를 지운다. */
function strip(o: Objects, id: string, match: (bp: string) => boolean) {
  const keys = Object.keys(o[id]).filter((k) => {
    const m = /@bp:(.+)$/.exec(k);
    return m && match(m[1]);
  });
  if (!keys.length) return;
  const next = { ...o[id] };
  for (const k of keys) delete next[k];
  o[id] = next;
}

function get(o: Objects, id: string): Obj {
  if (!Object.hasOwn(o, id)) throw new Reject("UNKNOWN_OBJECT", id, null, "없는 객체다");
  return o[id];
}

function checkProps(o: Objects, type: ObjType, id: string, frame: string, props: Record<string, unknown>, warnings: Warning[]) {
  for (const [k, v] of Object.entries(props)) {
    if (k === "type") throw new Reject("TYPE_IMMUTABLE", id, k, "type은 바꿀 수 없다");
    const at = k.indexOf("@");
    const base = at < 0 ? k : k.slice(0, at);
    if (!Object.hasOwn(KEYS[type], base))
      throw new Reject("KEY_NOT_ALLOWED", id, k, `${type}에 없는 키다. parent·order는 move로 바꾼다`);
    if (type === "token" && at >= 0) {
      if (base !== "value" || !/^@ctx:[a-z][a-z0-9-]*$/.test(k.slice(at)))
        throw new Reject("KEY_INVALID", id, k, "토큰의 조건 키는 value@ctx:<컨텍스트>만 쓴다");
    } else if (at >= 0) {
      const cond = k.slice(at);
      if (/^@(var|state):/.test(cond)) throw new Reject("CONDITION_NOT_ALLOWED", id, k, "@var·@state는 컴포넌트 원본에서만 쓴다");
      const m = /^@bp:([A-Za-z0-9_-]{6,32})$/.exec(cond);
      if (!m) throw new Reject("KEY_INVALID", id, k, "조건 키 문법이 맞지 않는다");
      if (type === "breakpoint" || !bpAllowed(base))
        throw new Reject("CONDITION_NOT_ALLOWED", id, k, "이 키는 BP마다 다르게 둘 수 없다");
      const bp = o[m[1]];
      if (!bp || bp.type !== "breakpoint" || bp.parent !== frame)
        throw new Reject("CONDITION_TARGET_MISSING", id, k, "같은 Frame의 breakpoint가 아니다");
    }
    if (v !== null && !KEYS[type][base].safeParse(v).success) throw new Reject("VALUE_INVALID", id, k, "값 형식이 맞지 않는다");
    if (v !== null && typeof v === "object" && "token" in v) checkBinding(o, id, k, base, (v as { token: string }).token, warnings);
  }
}

function checkBinding(o: Objects, id: string, k: string, base: string, ref: string, warnings: Warning[]) {
  const t = o[ref];
  if (!t || t.type !== "token") throw new Reject("UNKNOWN_OBJECT", ref, k, "바인딩한 토큰이 없다");
  if (t.tokenType !== BIND_TYPE[base])
    throw new Reject("TOKEN_TYPE_MISMATCH", id, k, `${base}에는 ${BIND_TYPE[base]} 토큰만 바인딩한다`);
  if (t.deprecated) warnings.push({ code: "TOKEN_DEPRECATED", id, key: k });
  if (!TokenRef.safeParse(t.value).success) warnings.push({ code: "RAW_TOKEN_BOUND", id, key: k });
}

/** 노드 바인딩이나 다른 토큰의 참조가 가리키는 토큰은 지울 수 없다. */
function checkUnused(o: Objects, token: string) {
  for (const [id, x] of Object.entries(o))
    for (const [k, v] of Object.entries(x)) {
      const r = v as { token?: string; ref?: string } | null;
      if (typeof r === "object" && r && (r.token === token || r.ref === token))
        throw new Reject("TOKEN_IN_USE", token, null, `${id}의 ${k}가 이 토큰을 쓴다`);
    }
}

/** modifier에서 빠진 컨텍스트의 토큰 값을 지운다. */
function dropContexts(o: Objects, modifier: string) {
  const keep = new Set((o[modifier].contexts as string[] | undefined) ?? []);
  for (const [id, t] of Object.entries(o)) {
    if (t.type !== "token" || t.variesBy !== modifier) continue;
    const gone = Object.keys(t).filter((k) => k.startsWith("value@ctx:") && !keep.has(k.slice(10)));
    if (!gone.length) continue;
    const next = { ...t };
    for (const k of gone) delete next[k];
    o[id] = next;
  }
}

/** 토큰과 modifier의 일관성을 검사한다: 이름 유일, 필수 키, 값 형식, 참조 타입, 컨텍스트, 순환. */
function checkTokens(o: Objects) {
  const names = new Map<string, string>([["modifier:mode", "_mode"]]);
  const unique = (kind: string, id: string, name: unknown) => {
    const key = `${kind}:${name}`;
    if (names.has(key) && names.get(key) !== id) throw new Reject("NAME_CONFLICT", id, "name", `${name} 이름이 이미 있다`);
    names.set(key, id);
  };
  for (const [id, m] of Object.entries(o)) {
    if (m.type !== "modifier") continue;
    if (!m.name || !m.contexts || !m.default) throw new Reject("VALUE_INVALID", id, null, "modifier에는 name·contexts·default가 필요하다");
    unique("modifier", id, m.name);
    if (!(m.contexts as string[]).includes(m.default as string))
      throw new Reject("VALUE_INVALID", id, "default", "default는 contexts 중 하나여야 한다");
  }
  const tokens = tokensOf(o);
  for (const [id, t] of tokens) {
    if (!t.name || !t.tokenType || t.value === undefined)
      throw new Reject("VALUE_INVALID", id, null, "토큰에는 name·tokenType·value가 필요하다");
    unique("token", id, t.name);
    const by = t.variesBy as string | undefined;
    const mod = by === undefined ? undefined : modifierOf(o, by);
    if (by !== undefined && !mod) throw new Reject("UNKNOWN_OBJECT", by, "variesBy", "variesBy가 가리키는 modifier가 없다");
    for (const [k, v] of Object.entries(t)) {
      if (k !== "value" && !k.startsWith("value@ctx:")) continue;
      if (k !== "value" && !(mod?.contexts as string[] | undefined)?.includes(k.slice(10)))
        throw new Reject("CONDITION_TARGET_MISSING", id, k, "variesBy modifier의 컨텍스트가 아니다");
      const ref = TokenRef.safeParse(v);
      if (ref.success) {
        const target = o[ref.data.ref];
        if (!target || target.type !== "token") throw new Reject("UNKNOWN_OBJECT", ref.data.ref, k, "참조한 토큰이 없다");
        if (target.tokenType !== t.tokenType) throw new Reject("TOKEN_TYPE_MISMATCH", id, k, "참조 대상의 tokenType이 다르다");
      } else if (!TOKEN_VALUE[t.tokenType as TokenType].safeParse(v).success)
        throw new Reject("VALUE_INVALID", id, k, `${t.tokenType} 값 형식이 맞지 않는다`);
    }
  }
  checkCycles(o, tokens);
}

/** 모든 modifier 컨텍스트 조합에서 참조를 따라가 순환이 있는지 검사한다. */
function checkCycles(o: Objects, tokens: [string, Obj][]) {
  let combos: Record<string, string>[] = [{}];
  for (const [mid, m] of modifiersOf(o))
    combos = combos.flatMap((c) => (m.contexts as string[]).map((ctx) => ({ ...c, [mid]: ctx })));
  for (const combo of combos) {
    const state = new Map<string, 1 | 2>();
    const visit = (id: string) => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) throw new Reject("TOKEN_CYCLE", id, null, `참조가 순환한다 (${Object.values(combo).join(", ")})`);
      state.set(id, 1);
      const ref = TokenRef.safeParse(tokenValueAt(o[id], combo));
      if (ref.success) visit(ref.data.ref);
      state.set(id, 2);
    };
    for (const [id] of tokens) visit(id);
  }
}

/** Frame의 BP minWidth가 서로 다르고 Frame minWidth보다 큰지 검사한다. */
function checkBreakpoints(o: Objects, frame: string, id: string) {
  const min = (o[frame].minWidth as number) ?? 320;
  const seen = new Set<number>();
  for (const [bid, bp] of breakpointsOf(o, frame)) {
    const w = bp.minWidth as number | undefined;
    if (w === undefined) throw new Reject("VALUE_INVALID", bid, "minWidth", "breakpoint에는 minWidth가 필요하다");
    if (w <= min || seen.has(w))
      throw new Reject("VALUE_INVALID", id, "minWidth", "BP minWidth는 Frame 안에서 서로 다르고 Frame minWidth보다 커야 한다");
    seen.add(w);
  }
}

function checkParent(o: Objects, type: ObjType, id: string, parent: string | null) {
  const pType = parent === null ? null : get(o, parent).type;
  if (!PARENTS[type].includes(pType))
    throw new Reject("INVALID_PARENT", id, null, `${type}의 부모로 ${pType ?? "보드"}를 쓸 수 없다`);
  for (let p = parent; p !== null; p = o[p].parent)
    if (p === id) throw new Reject("TREE_CYCLE", id, null, "자기 하위로 이동할 수 없다");
}

function orderAt(o: Objects, parent: string | null, pos: Placement, self: string): string {
  const sibs = childrenOf(o, parent).filter(([id]) => id !== self);
  const at = (i: number) => sibs[i]?.[1].order ?? null;
  if (pos === "first") return generateKeyBetween(null, at(0));
  if (pos === "last") return generateKeyBetween(at(sibs.length - 1), null);
  const anchor = "before" in pos ? pos.before : pos.after;
  get(o, anchor);
  const i = sibs.findIndex(([id]) => id === anchor);
  if (i < 0) throw new Reject("VALUE_INVALID", self, null, "기준 노드가 대상 부모의 형제가 아니다");
  return "before" in pos ? generateKeyBetween(at(i - 1), at(i)) : generateKeyBetween(at(i), at(i + 1));
}
