import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { KEYS, PARENTS, Tx, type NodeType, type Op, type Placement } from "./schema";

export type Obj = { type: NodeType; parent: string | null; order: string } & Record<string, unknown>;
export type Objects = Record<string, Obj>;
export type Doc = { schemaVersion: 1; objects: Objects };

export type ErrorCode =
  | "SCHEMA_INVALID"
  | "UNKNOWN_OBJECT"
  | "ID_CONFLICT"
  | "TYPE_IMMUTABLE"
  | "INVALID_PARENT"
  | "TREE_CYCLE"
  | "KEY_NOT_ALLOWED"
  | "VALUE_INVALID";

export type OpError = {
  code: ErrorCode;
  opIndex: number | null;
  id: string | null;
  key: string | null;
  message: string;
};

export type Change = { id: string; key: string; before: unknown; after: unknown };

export type Result = { ok: true; doc: Doc; changes: Change[] } | { ok: false; error: OpError };

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
  for (let i = 0; i < ops.length; i++) {
    try {
      apply(objects, ops[i]);
    } catch (e) {
      if (!(e instanceof Reject)) throw e;
      return { ok: false, error: { code: e.code, opIndex: i, id: e.id, key: e.key, message: e.message } };
    }
  }
  return { ok: true, doc: { ...doc, objects }, changes: diff(doc.objects, objects) };
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

/** parent의 자식을 (order, id) 사전순으로 돌려준다. parent가 null이면 보드 위 Frame이다. */
export function childrenOf(objects: Objects, parent: string | null): [string, Obj][] {
  return Object.entries(objects)
    .filter(([, o]) => o.parent === parent)
    .sort(([a, x], [b, y]) => (x.order !== y.order ? (x.order < y.order ? -1 : 1) : a < b ? -1 : 1));
}

function apply(o: Objects, op: Op) {
  switch (op.op) {
    case "create": {
      if (Object.hasOwn(o, op.id) || op.id === "mode" || op.id.startsWith("_"))
        throw new Reject("ID_CONFLICT", op.id, null, "이미 있거나 예약된 ID다");
      const props = op.props ?? {};
      checkProps(op.type, op.id, props);
      checkParent(o, op.type, op.id, op.parent);
      const obj: Obj = { type: op.type, parent: op.parent, order: orderAt(o, op.parent, op.placement, op.id) };
      for (const [k, v] of Object.entries(props)) if (v !== null) obj[k] = v;
      o[op.id] = obj;
      return;
    }
    case "set": {
      const obj = get(o, op.id);
      checkProps(obj.type, op.id, op.props);
      const next = { ...obj };
      for (const [k, v] of Object.entries(op.props)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      o[op.id] = next;
      return;
    }
    case "move": {
      const obj = get(o, op.id);
      checkParent(o, obj.type, op.id, op.parent);
      o[op.id] = { ...obj, parent: op.parent, order: orderAt(o, op.parent, op.placement, op.id) };
      return;
    }
    case "delete": {
      get(o, op.id);
      const kids = new Map<string | null, string[]>();
      for (const [id, x] of Object.entries(o)) {
        const list = kids.get(x.parent);
        if (list) list.push(id);
        else kids.set(x.parent, [id]);
      }
      const stack = [op.id];
      while (stack.length) {
        const id = stack.pop()!;
        delete o[id];
        stack.push(...(kids.get(id) ?? []));
      }
      return;
    }
  }
}

function get(o: Objects, id: string): Obj {
  if (!Object.hasOwn(o, id)) throw new Reject("UNKNOWN_OBJECT", id, null, "없는 객체다");
  return o[id];
}

function checkProps(type: NodeType, id: string, props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) {
    if (k === "type") throw new Reject("TYPE_IMMUTABLE", id, k, "type은 바꿀 수 없다");
    if (!Object.hasOwn(KEYS[type], k))
      throw new Reject("KEY_NOT_ALLOWED", id, k, `${type}에 없는 키다. parent·order는 move로 바꾼다`);
    if (v !== null && !KEYS[type][k].safeParse(v).success)
      throw new Reject("VALUE_INVALID", id, k, "값 형식이 맞지 않는다");
  }
}

function checkParent(o: Objects, type: NodeType, id: string, parent: string | null) {
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
