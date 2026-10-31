import { describe, expect, it } from "vitest";
import { applyOps, childrenOf, revert, type Doc, type Op } from ".";

const empty: Doc = { schemaVersion: 1, objects: {} };

function run(doc: Doc, ...ops: Op[]) {
  return applyOps(doc, { txId: "tx1", actor: "user:test", ops });
}

function ok(doc: Doc, ...ops: Op[]): Doc {
  const r = run(doc, ...ops);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.doc;
}

function code(doc: Doc, ...ops: Op[]) {
  const r = run(doc, ...ops);
  return r.ok ? null : r.error.code;
}

const base = ok(
  empty,
  { op: "create", id: "frame1", type: "frame", parent: null, placement: "last", props: { name: "Home" } },
  { op: "create", id: "sect01", type: "section", parent: "frame1", placement: "last" },
  { op: "create", id: "box001", type: "container", parent: "sect01", placement: "last" },
  { op: "create", id: "box002", type: "container", parent: "box001", placement: "last" },
);

const ids = (doc: Doc, parent: string | null) => childrenOf(doc.objects, parent).map(([id]) => id);

describe("create", () => {
  it("같은 트랜잭션에서 만든 노드를 바로 참조한다", () => {
    expect(ids(base, "box001")).toEqual(["box002"]);
    expect(base.objects.frame1.name).toBe("Home");
  });

  it("위치 지정으로 형제 순서를 정한다", () => {
    const doc = ok(
      base,
      { op: "create", id: "txt001", type: "text", parent: "sect01", placement: "first" },
      { op: "create", id: "txt002", type: "text", parent: "sect01", placement: { after: "txt001" } },
      { op: "create", id: "txt003", type: "text", parent: "sect01", placement: { before: "box001" } },
    );
    expect(ids(doc, "sect01")).toEqual(["txt001", "txt002", "txt003", "box001"]);
  });

  it("중복·예약 ID를 거부한다", () => {
    expect(code(base, { op: "create", id: "box001", type: "container", parent: "sect01", placement: "last" })).toBe(
      "ID_CONFLICT",
    );
    expect(code(base, { op: "create", id: "_hidden", type: "container", parent: "sect01", placement: "last" })).toBe(
      "ID_CONFLICT",
    );
  });

  it("부모 규칙을 지킨다", () => {
    expect(code(base, { op: "create", id: "sect02", type: "section", parent: "box001", placement: "last" })).toBe(
      "INVALID_PARENT",
    );
    expect(code(base, { op: "create", id: "txt001", type: "text", parent: null, placement: "last" })).toBe(
      "INVALID_PARENT",
    );
    expect(code(base, { op: "create", id: "txt001", type: "text", parent: "nobody", placement: "last" })).toBe(
      "UNKNOWN_OBJECT",
    );
  });

  it("기준 노드가 형제가 아니면 거부한다", () => {
    expect(
      code(base, { op: "create", id: "txt001", type: "text", parent: "sect01", placement: { after: "box002" } }),
    ).toBe("VALUE_INVALID");
  });
});

describe("set", () => {
  it("값을 설정하고 null로 지운다", () => {
    const a = ok(base, { op: "set", id: "box001", props: { "layout.mode": "grid", "layout.columns": 3 } });
    expect(a.objects.box001["layout.mode"]).toBe("grid");
    const b = ok(a, { op: "set", id: "box001", props: { "layout.mode": null } });
    expect("layout.mode" in b.objects.box001).toBe(false);
    expect(b.objects.box001["layout.columns"]).toBe(3);
  });

  it("키와 값을 검증한다", () => {
    expect(code(base, { op: "set", id: "box001", props: { type: "text" } })).toBe("TYPE_IMMUTABLE");
    expect(code(base, { op: "set", id: "box001", props: { content: "x" } })).toBe("KEY_NOT_ALLOWED");
    expect(code(base, { op: "set", id: "box001", props: { parent: "frame1" } })).toBe("KEY_NOT_ALLOWED");
    expect(code(base, { op: "set", id: "box001", props: { "style.color@bp:bp1": "x" } })).toBe("KEY_NOT_ALLOWED");
    expect(code(base, { op: "set", id: "box001", props: { toString: 1 } })).toBe("KEY_NOT_ALLOWED");
    expect(code(base, { op: "set", id: "box001", props: { "layout.mode": "block" } })).toBe("VALUE_INVALID");
    expect(code(base, { op: "set", id: "box001", props: { "layout.mode": "absolute" } })).toBe("VALUE_INVALID");
    expect(code(base, { op: "set", id: "box001", props: { position: "absolute", w: -1 } })).toBe("VALUE_INVALID");
    expect(code(base, { op: "set", id: "frame1", props: { position: "absolute" } })).toBe("KEY_NOT_ALLOWED");
    expect(
      code(base, { op: "set", id: "box001", props: { "size.width": { value: 1.23456, unit: "px" } } }),
    ).toBe("VALUE_INVALID");
  });
});

describe("move", () => {
  it("부모와 순서를 바꾼다", () => {
    const doc = ok(base, { op: "move", id: "box002", parent: "sect01", placement: "first" });
    expect(ids(doc, "sect01")).toEqual(["box002", "box001"]);
    expect(ids(doc, "box001")).toEqual([]);
  });

  it("같은 부모 안에서 뒤로 옮긴다", () => {
    const a = ok(base, { op: "create", id: "txt001", type: "text", parent: "sect01", placement: "first" });
    const b = ok(a, { op: "move", id: "txt001", parent: "sect01", placement: { after: "box001" } });
    expect(ids(b, "sect01")).toEqual(["box001", "txt001"]);
  });

  it("순환을 거부한다", () => {
    expect(code(base, { op: "move", id: "box001", parent: "box002", placement: "last" })).toBe("TREE_CYCLE");
    expect(code(base, { op: "move", id: "box001", parent: "box001", placement: "last" })).toBe("TREE_CYCLE");
  });
});

describe("delete", () => {
  it("하위 노드를 함께 지운다", () => {
    const doc = ok(base, { op: "delete", id: "sect01" });
    expect(Object.keys(doc.objects)).toEqual(["frame1"]);
  });
});

describe("트랜잭션", () => {
  it("하나라도 실패하면 전부 거부하고 입력을 바꾸지 않는다", () => {
    const before = structuredClone(base);
    const r = run(
      base,
      { op: "delete", id: "box002" },
      { op: "set", id: "box001", props: { "layout.mode": "nope" } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "VALUE_INVALID", opIndex: 1, id: "box001", key: "layout.mode" });
    expect(base).toEqual(before);
  });

  it("스키마 위반은 SCHEMA_INVALID와 연산 위치를 돌려준다", () => {
    const r = applyOps(base, { txId: "t", actor: "user:a", ops: [{ op: "delete", id: "box002" }, { op: "detach", id: "box001" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "SCHEMA_INVALID", opIndex: 1 });
    expect(code(base)).toBe("SCHEMA_INVALID");
  });
});

describe("revert", () => {
  const apply = (doc: Doc, ...ops: Op[]) => {
    const r = run(doc, ...ops);
    if (!r.ok) throw new Error(r.error.code);
    return r;
  };

  it("create·set·move·delete를 모두 되돌리고 다시 적용한다", () => {
    const r = apply(
      base,
      { op: "create", id: "txt001", type: "text", parent: "sect01", placement: "first", props: { content: "a" } },
      { op: "set", id: "box001", props: { "layout.mode": "grid" } },
      { op: "move", id: "box002", parent: "sect01", placement: "last" },
      { op: "delete", id: "frame1" },
    );
    expect(r.doc.objects).toEqual({});
    const undo = revert(r.doc, r.changes);
    expect(undo.doc).toEqual(base);
    expect(revert(undo.doc, undo.changes).doc).toEqual(r.doc);
  });

  it("이후 다른 값으로 바뀐 키는 건너뛴다", () => {
    const a = apply(base, { op: "set", id: "box001", props: { name: "A", hidden: true } });
    const b = ok(a.doc, { op: "set", id: "box001", props: { name: "B" } });
    const undo = revert(b, a.changes);
    expect(undo.doc.objects.box001.name).toBe("B");
    expect("hidden" in undo.doc.objects.box001).toBe(false);
    expect(undo.changes).toEqual([{ id: "box001", key: "hidden", before: true, after: undefined }]);
  });
});
