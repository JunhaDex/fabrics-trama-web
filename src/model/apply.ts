import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { detachId } from "./hash";
import {
  BIND_TYPE,
  condAllowed,
  Id,
  KEYS,
  NODE_TYPES,
  OVERRIDE_KEYS,
  PARENTS,
  STATES,
  TOKEN_VALUE,
  TokenRef,
  Tx,
  type Condition,
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
  | "COMPONENT_IN_USE"
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

/** parent의 자식 노드를 (order, id) 사전순으로 돌려준다. parent가 null이면 보드 위 Frame과 컴포넌트다. 노드가 아닌 객체는 포함하지 않는다. */
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

/** 참조를 따라가 컨텍스트 조합에서의 원시값과 그 값을 가진 토큰 ID를 돌려준다. 순환은 검증 단계에서 막는다. */
export function resolveToken(objects: Objects, id: string, combo: Record<string, string>): { value: unknown; source: string } {
  let cur = id;
  for (;;) {
    const v = tokenValueAt(objects[cur], combo);
    if (v && typeof v === "object" && "ref" in v) cur = (v as { ref: string }).ref;
    else return { value: v, source: cur };
  }
}

const modifierOf = (o: Objects, id: string): Obj | undefined => (id === "_mode" ? MODE : o[id]?.type === "modifier" ? o[id] : undefined);

/** Frame의 breakpoint를 minWidth 오름차순으로 돌려준다. */
export function breakpointsOf(objects: Objects, frame: string): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.parent === frame && o.type === "breakpoint")
    .sort(([, x], [, y]) => (x.minWidth as number) - (y.minWidth as number));
}

/** 객체가 속한 루트(Frame 또는 컴포넌트)의 ID. */
export function frameOf(objects: Objects, id: string): string {
  let cur = id;
  while (objects[cur].parent !== null) cur = objects[cur].parent!;
  return cur;
}

export type Key = { base: string; bp?: string; cq?: number; var?: [prop: string, option: string]; state?: (typeof STATES)[number] };

const KEY_RE = new RegExp(
  "^([^@]+)(?:@bp:([A-Za-z0-9_-]{6,32})|@cq:([1-9][0-9]{0,4}))?(?:@var:([A-Za-z0-9_-]{6,32})=([a-z][a-z0-9-]*))?(?:@state:(" +
    STATES.join("|") +
    "))?$",
);

/** 노드 속성 키를 기본키와 조건으로 나눈다. 문법이나 조건 순서가 맞지 않으면 null이다. */
export function parseKey(k: string): Key | null {
  const m = KEY_RE.exec(k);
  if (!m) return null;
  const key: Key = { base: m[1] };
  if (m[2]) key.bp = m[2];
  if (m[3]) key.cq = Number(m[3]);
  if (m[4]) key.var = [m[4], m[5]];
  if (m[6]) key.state = m[6] as Key["state"];
  return key;
}

/** componentProp이 받는 옵션 값. boolean은 `["true", "false"]`다. */
export const optionsOf = (cp: Obj): string[] => (cp.kind === "boolean" ? ["true", "false"] : ((cp.options as string[] | undefined) ?? []));

/** 컴포넌트의 componentProp을 이름순(정의 순서)으로 돌려준다. */
export function componentPropsOf(objects: Objects, comp: string): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.parent === comp && o.type === "componentProp")
    .sort(([, a], [, b]) => ((a.name as string) < (b.name as string) ? -1 : 1));
}

/**
 * 인스턴스 override 경로(`a/b/c`)가 가리키는 노드 ID. 첫 구간은 comp 트리의 노드이고, 다음 구간이 있으면 그 노드는
 * 인스턴스이며 다음 구간은 그 인스턴스의 컴포넌트 트리 노드다. 가리키는 노드가 없으면 null이다.
 */
export function overrideTarget(objects: Objects, comp: string, path: string[]): string | null {
  let cur = comp;
  for (let i = 0; i < path.length; i++) {
    const n = objects[path[i]];
    if (!n || !isNode(n) || frameOf(objects, path[i]) !== cur) return null;
    if (i < path.length - 1) {
      if (n.type !== "instance") return null;
      cur = n.component as string;
    }
  }
  return path[path.length - 1] ?? null;
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
      const root = op.parent === null ? op.id : frameOf(o, op.parent);
      if (op.type === "instance") {
        const c = props.component;
        if (typeof c !== "string") throw new Reject("VALUE_INVALID", op.id, "component", "instance에는 component가 필요하다");
        if (o[c]?.type !== "component") throw new Reject("UNKNOWN_OBJECT", c, "component", "component가 가리키는 컴포넌트가 없다");
        checkUses(o, root, c, op.id);
      }
      checkProps(o, op.type, op.id, root, props, warnings, true);
      const obj: Obj = { type: op.type, parent: op.parent };
      if (node) obj.order = orderAt(o, op.parent, op.placement!, op.id);
      for (const [k, v] of Object.entries(props)) if (v !== null) obj[k] = v;
      o[op.id] = obj;
      if (op.type === "breakpoint") checkBreakpoints(o, op.parent!, op.id);
      if (op.type === "componentProp") checkComponentProps(o, op.parent!);
      if (tokenish(op.type)) checkTokens(o);
      return;
    }
    case "set": {
      const obj = get(o, op.id);
      checkProps(o, obj.type, op.id, frameOf(o, op.id), op.props, warnings);
      const next = { ...obj };
      // 같은 연산에서 준 @ctx 값이 지워지지 않도록, props를 쓰기 전에 이전 @ctx 키를 지운다.
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
      if (obj.type === "componentProp") {
        checkComponentProps(o, obj.parent!);
        dropOptions(o, op.id, obj.parent!, new Set(optionsOf(o[op.id])));
      }
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
      const to = frameOf(o, op.id);
      if (to !== from) {
        for (const id of subtree(o, op.id)) {
          strip(o, id, () => true);
          if (o[id].type === "instance") checkUses(o, to, o[id].component as string, id);
        }
        prune(o);
      }
      return;
    }
    case "delete": {
      const obj = get(o, op.id);
      if (obj.type === "token") checkUnused(o, op.id);
      if (obj.type === "modifier" && Object.values(o).some((t) => t.type === "token" && t.variesBy === op.id))
        throw new Reject("TOKEN_IN_USE", op.id, null, "이 modifier에 따라 달라지는 토큰이 있다");
      if (obj.type === "component" && Object.values(o).some((x) => x.type === "instance" && x.component === op.id))
        throw new Reject("COMPONENT_IN_USE", op.id, null, "이 컴포넌트의 인스턴스가 있다");
      for (const id of subtree(o, op.id)) delete o[id];
      if (obj.type === "breakpoint") for (const id of Object.keys(o)) strip(o, id, (c) => c === `@bp:${op.id}`);
      if (obj.type === "componentProp") dropOptions(o, op.id, obj.parent!, new Set());
      if (isNode(obj)) prune(o);
      return;
    }
    case "detach":
      return detach(o, op.id);
  }
}

/** root 트리에 comp의 인스턴스를 두었을 때 컴포넌트가 자기 자신을 (중첩해서) 포함하게 되면 거부한다. */
function checkUses(o: Objects, root: string, comp: string, id: string) {
  if (o[root]?.type !== "component" && root !== id) return;
  const seen = new Set<string>();
  const visit = (c: string) => {
    if (c === root) throw new Reject("TREE_CYCLE", id, "component", "컴포넌트가 자기 자신의 인스턴스를 포함하게 된다");
    if (seen.has(c)) return;
    seen.add(c);
    for (const n of subtree(o, c)) if (o[n].type === "instance") visit(o[n].component as string);
  };
  visit(comp);
}

/** componentProp의 필수 키, 옵션, 기본값, 컴포넌트 안 이름 유일성을 검사한다. */
function checkComponentProps(o: Objects, comp: string) {
  const names = new Set<string>();
  for (const [id, cp] of componentPropsOf(o, comp)) {
    if (!cp.name || !cp.kind || cp.default === undefined)
      throw new Reject("VALUE_INVALID", id, null, "componentProp에는 name·kind·default가 필요하다");
    if ((cp.kind === "enum") !== (cp.options !== undefined))
      throw new Reject("VALUE_INVALID", id, "options", "options는 enum에만, enum에는 반드시 둔다");
    if (!optionsOf(cp).includes(cp.default as string)) throw new Reject("VALUE_INVALID", id, "default", "default는 옵션 값 중 하나여야 한다");
    if (names.has(cp.name as string)) throw new Reject("NAME_CONFLICT", id, "name", `${cp.name} 속성이 이미 있다`);
    names.add(cp.name as string);
  }
}

/** keep에 없는 옵션을 가리키는 `@var:` 키와 인스턴스 `props.` 값을 지운다. */
function dropOptions(o: Objects, cp: string, comp: string, keep: Set<string>) {
  for (const id of subtree(o, comp)) strip(o, id, (c) => c.startsWith(`@var:${cp}=`) && !keep.has(c.slice(cp.length + 6).split("@")[0]));
  for (const [id, x] of Object.entries(o)) {
    const v = x[`props.${cp}`];
    if (x.type !== "instance" || v === undefined || keep.has(v as string)) continue;
    const next = { ...x };
    delete next[`props.${cp}`];
    o[id] = next;
  }
}

/** 경로가 더는 노드를 가리키지 않는 인스턴스 override를 지운다. */
function prune(o: Objects) {
  for (const [id, x] of Object.entries(o)) {
    if (x.type !== "instance") continue;
    const gone = Object.keys(x).filter((k) => k.startsWith("node.") && !overrideTarget(o, x.component as string, k.slice(5, k.indexOf(".", 5)).split("/")));
    if (!gone.length) continue;
    const next = { ...x };
    for (const k of gone) delete next[k];
    o[id] = next;
  }
}

/**
 * 인스턴스를 같은 위치의 일반 노드 트리로 바꾼다. 노드 ID는 detachId로 정한다. 인스턴스가 고른 변형의 `@var` 값과
 * override는 base 값으로 굳히고, `@state`·`@cq` 키는 일반 노드가 가질 수 없으므로 버린다. 중첩 인스턴스는 인스턴스로 남는다.
 */
function detach(o: Objects, id: string) {
  const inst = get(o, id);
  if (inst.type !== "instance") throw new Reject("VALUE_INVALID", id, null, "인스턴스만 연결 해제할 수 있다");
  const comp = inst.component as string;
  const picked = new Set(componentPropsOf(o, comp).map(([cp, p]) => `@var:${cp}=${(inst[`props.${cp}`] as string) ?? p.default}`));
  const overrides = new Map<string, [string, unknown][]>();
  for (const [k, v] of Object.entries(inst)) {
    if (!k.startsWith("node.")) continue;
    const dot = k.indexOf(".", 5);
    const path = k.slice(5, dot);
    const head = path.split("/")[0];
    overrides.set(head, [...(overrides.get(head) ?? []), [path.includes("/") ? `node.${path.slice(head.length + 1)}${k.slice(dot)}` : k.slice(dot + 1), v]]);
  }
  const bake = (src: Obj, type: ObjType): Obj => {
    const out = {} as Obj;
    for (const [k, v] of Object.entries(src)) if (!k.includes("@")) out[k] = v;
    for (const [k, v] of Object.entries(src)) {
      const at = k.indexOf("@");
      if (at >= 0 && picked.has(k.slice(at))) out[k.slice(0, at)] = v;
    }
    for (const k of Object.keys(out)) if (k !== "type" && k !== "parent" && k !== "order" && !k.startsWith("node.") && !k.startsWith("props.") && !Object.hasOwn(KEYS[type], k)) delete out[k];
    return out;
  };
  const created: Objects = {};
  const rootId = detachId(id, comp);
  const r = bake(o[comp], "container");
  for (const [k, v] of overrides.get(comp) ?? []) r[k] = v;
  for (const [k, v] of Object.entries(inst)) if (k !== "component" && !k.startsWith("props.") && !k.startsWith("node.")) r[k] = v;
  created[rootId] = { ...r, type: "container", parent: inst.parent, order: inst.order };
  for (const n of subtree(o, comp)) {
    if (n === comp || !isNode(o[n])) continue;
    const src = o[n];
    const x = bake(src, src.type);
    for (const [k, v] of overrides.get(n) ?? []) x[k] = v;
    created[detachId(id, n)] = { ...x, type: src.type, parent: detachId(id, src.parent!), order: src.order };
  }
  delete o[id];
  for (const [nid, x] of Object.entries(created)) {
    if (Object.hasOwn(o, nid)) throw new Reject("ID_CONFLICT", nid, null, "연결 해제로 만들 ID가 이미 있다");
    o[nid] = x;
  }
  prune(o);
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

/** 조건 부분(`@` 이후)이 match를 만족하는 조건 키를 지운다. */
function strip(o: Objects, id: string, match: (cond: string) => boolean) {
  const keys = Object.keys(o[id]).filter((k) => {
    const at = k.indexOf("@");
    return at >= 0 && match(k.slice(at));
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

function checkProps(o: Objects, type: ObjType, id: string, root: string, props: Record<string, unknown>, warnings: Warning[], creating = false) {
  const rootType = root === id ? type : o[root].type;
  for (const [k, v] of Object.entries(props)) {
    if (k === "type" || (type === "instance" && k === "component" && !creating))
      throw new Reject("TYPE_IMMUTABLE", id, k, `${k}는 바꿀 수 없다`);
    if (type === "instance" && (k.startsWith("props.") || k.startsWith("node."))) {
      const comp = (creating ? props.component : o[id].component) as string;
      if (k.startsWith("props.")) checkPropValue(o, id, k, comp, v);
      else checkOverride(o, id, k, comp, v, warnings);
      continue;
    }
    const at = k.indexOf("@");
    const base = at < 0 ? k : k.slice(0, at);
    if (!Object.hasOwn(KEYS[type], base))
      throw new Reject("KEY_NOT_ALLOWED", id, k, `${type}에 없는 키다. parent·order는 move로 바꾼다`);
    if (type === "token" && at >= 0) {
      if (base !== "value" || !/^@ctx:[a-z][a-z0-9-]*$/.test(k.slice(at)))
        throw new Reject("KEY_INVALID", id, k, "토큰의 조건 키는 value@ctx:<컨텍스트>만 쓴다");
    } else if (at >= 0) {
      const key = parseKey(k);
      if (!key) throw new Reject("KEY_INVALID", id, k, "조건 키 문법이나 조건 순서(bp|cq → var → state)가 맞지 않는다");
      const conds = (["bp", "cq", "var", "state"] as Condition[]).filter((c) => key[c] !== undefined);
      if (!isNode({ type } as Obj) || conds.some((c) => !condAllowed(base, c)))
        throw new Reject("CONDITION_NOT_ALLOWED", id, k, "이 키는 그 조건으로 다르게 둘 수 없다");
      if (key.cq !== undefined && conds.length > 1) throw new Reject("CONDITION_NOT_ALLOWED", id, k, "@cq는 다른 조건과 함께 쓸 수 없다");
      if (key.bp !== undefined ? rootType !== "frame" : rootType !== "component")
        throw new Reject("CONDITION_NOT_ALLOWED", id, k, key.bp ? "@bp는 Frame 안의 노드에만 쓴다" : "@cq·@var·@state는 컴포넌트 원본에서만 쓴다");
      if (key.cq !== undefined && id === root) throw new Reject("CONDITION_NOT_ALLOWED", id, k, "컴포넌트 루트는 자기 폭을 조건으로 쓸 수 없다");
      if (key.bp !== undefined) {
        const bp = o[key.bp];
        if (!bp || bp.type !== "breakpoint" || bp.parent !== root)
          throw new Reject("CONDITION_TARGET_MISSING", id, k, "같은 Frame의 breakpoint가 아니다");
      }
      if (key.var) {
        const cp = o[key.var[0]];
        if (!cp || cp.type !== "componentProp" || cp.parent !== root || !optionsOf(cp).includes(key.var[1]))
          throw new Reject("CONDITION_TARGET_MISSING", id, k, "이 컴포넌트의 속성·옵션이 아니다");
      }
    }
    if (v !== null && !KEYS[type][base].safeParse(v).success) throw new Reject("VALUE_INVALID", id, k, "값 형식이 맞지 않는다");
    if (v !== null && typeof v === "object" && "token" in v) checkBinding(o, id, k, base, (v as { token: string }).token, warnings);
  }
}

function checkPropValue(o: Objects, id: string, k: string, comp: string, v: unknown) {
  const cp = o[k.slice(6)];
  if (!cp || cp.type !== "componentProp" || cp.parent !== comp)
    throw new Reject("CONDITION_TARGET_MISSING", id, k, "인스턴스 컴포넌트의 속성이 아니다");
  if (v !== null && !optionsOf(cp).includes(v as string)) throw new Reject("VALUE_INVALID", id, k, "속성의 옵션 값이 아니다");
}

function checkOverride(o: Objects, id: string, k: string, comp: string, v: unknown, warnings: Warning[]) {
  const dot = k.indexOf(".", 5);
  const path = dot < 0 ? [] : k.slice(5, dot).split("/");
  const base = k.slice(dot + 1);
  if (!path.length || path.some((s) => !Id.safeParse(s).success)) throw new Reject("KEY_INVALID", id, k, "override 키는 node.<경로>.<키>다");
  if (base.includes("@")) throw new Reject("CONDITION_NOT_ALLOWED", id, k, "override에는 조건을 붙일 수 없다");
  const target = overrideTarget(o, comp, path);
  if (!target) throw new Reject("CONDITION_TARGET_MISSING", id, k, "경로가 가리키는 노드가 없다");
  const t = o[target];
  const fixed = OVERRIDE_KEYS[base];
  const ok = fixed
    ? (base === "content" && t.type === "text") || ((base === "src" || base === "alt") && t.type === "image") || (base === "hidden" && t.parent !== null)
    : BIND_TYPE[base] !== undefined && typeof t[base] === "object" && t[base] !== null && "token" in (t[base] as object);
  if (!ok) throw new Reject("KEY_NOT_ALLOWED", id, k, "인스턴스에서 바꿀 수 없는 키다");
  if (v === null) return;
  if (fixed ? !fixed.safeParse(v).success : !(typeof v === "object" && "token" in v)) throw new Reject("VALUE_INVALID", id, k, "값 형식이 맞지 않는다");
  if (!fixed) checkBinding(o, id, k, base, (v as { token: string }).token, warnings);
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
