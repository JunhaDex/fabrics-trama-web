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
    const r = applyOps(base, { txId: "t", actor: "user:a", ops: [{ op: "delete", id: "box002" }, { op: "rename", id: "box001" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: "SCHEMA_INVALID", opIndex: 1 });
    expect(code(base)).toBe("SCHEMA_INVALID");
  });
});

describe("breakpoint", () => {
  const withBp = ok(
    base,
    { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { name: "Tablet", minWidth: 768 } },
  );
  const gap = { value: 8, unit: "px" };

  it("BP를 만들고 그 BP의 override를 설정한다", () => {
    const doc = ok(withBp, { op: "set", id: "box001", props: { "layout.gap@bp:bp0768": gap, "hidden@bp:bp0768": true } });
    expect(doc.objects.box001["layout.gap@bp:bp0768"]).toEqual(gap);
    expect(childrenOf(doc.objects, "frame1").map(([id]) => id)).toEqual(["sect01"]);
  });

  it("조건 키를 검증한다", () => {
    const set = (k: string, v: unknown = gap) => code(withBp, { op: "set", id: "box001", props: { [k]: v } });
    expect(set("layout.gap@bp:bp1")).toBe("KEY_INVALID");
    expect(set("layout.gap@bp:bp0768@bp:bp0768")).toBe("KEY_INVALID");
    expect(set("layout.gap@state:hover")).toBe("CONDITION_NOT_ALLOWED");
    expect(set("content@bp:bp0768", "x")).toBe("KEY_NOT_ALLOWED");
    expect(set("tag@bp:bp0768", "ul")).toBe("CONDITION_NOT_ALLOWED");
    expect(set("position@bp:bp0768", "absolute")).toBe("CONDITION_NOT_ALLOWED");
    expect(set("layout.gap@bp:nobody")).toBe("CONDITION_TARGET_MISSING");
    expect(set("layout.gap@bp:bp0768", "8px")).toBe("VALUE_INVALID");
  });

  it("BP minWidth는 Frame 안에서 유일하고 Frame minWidth보다 크다", () => {
    const bp = (id: string, minWidth: number) => ({ op: "create", id, type: "breakpoint", parent: "frame1", props: { minWidth } }) as Op;
    expect(code(withBp, bp("bp0769", 768))).toBe("VALUE_INVALID");
    expect(code(base, bp("bp0300", 300))).toBe("VALUE_INVALID");
    expect(code(withBp, { op: "set", id: "frame1", props: { minWidth: 800 } })).toBe("VALUE_INVALID");
    expect(code(base, { op: "create", id: "bp0000", type: "breakpoint", parent: "frame1" })).toBe("VALUE_INVALID");
    expect(code(base, { op: "create", id: "bp0768", type: "breakpoint", parent: "sect01", props: { minWidth: 768 } })).toBe("INVALID_PARENT");
    expect(code(base, { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", placement: "last", props: { minWidth: 768 } })).toBe("VALUE_INVALID");
    expect(code(base, { op: "create", id: "box003", type: "container", parent: "sect01" })).toBe("VALUE_INVALID");
  });

  it("BP를 지우면 그 BP의 override도 지운다", () => {
    const a = ok(withBp, { op: "set", id: "box001", props: { "layout.gap@bp:bp0768": gap, name: "A" } });
    const b = ok(a, { op: "delete", id: "bp0768" });
    expect(b.objects.box001).toEqual({ ...base.objects.box001, name: "A" });
  });

  it("다른 Frame으로 옮기면 원래 Frame의 override를 지운다", () => {
    const a = ok(
      withBp,
      { op: "set", id: "box002", props: { "layout.gap@bp:bp0768": gap } },
      { op: "create", id: "frame2", type: "frame", parent: null, placement: "last" },
      { op: "move", id: "box001", parent: "frame2", placement: "last" },
    );
    expect("layout.gap@bp:bp0768" in a.objects.box002).toBe(false);
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

describe("token", () => {
  const rgb = (r: number, g: number, b: number) => ({ colorSpace: "srgb", components: [r, g, b] });
  const tok = (id: string, props: object) => ({ op: "create", id, type: "token", parent: null, props }) as Op;
  const blue = rgb(0.2, 0.4, 1);
  const withTokens = ok(
    base,
    { op: "create", id: "palette", type: "modifier", parent: null, props: { name: "palette", contexts: ["brand", "mono"], default: "brand" } },
    tok("tkBlue1", { name: "color.blue", tokenType: "color", value: blue, variesBy: "palette", "value@ctx:mono": rgb(0.5, 0.5, 0.5) }),
    tok("tkPrim1", { name: "color.primary", tokenType: "color", value: { ref: "tkBlue1" }, variesBy: "_mode", "value@ctx:dark": rgb(1, 1, 1) }),
    tok("tkSpace", { name: "space.md", tokenType: "dimension", value: { value: 16, unit: "px" } }),
  );

  it("토큰과 modifier를 만들고 노드에 바인딩한다", () => {
    const r = run(withTokens, { op: "set", id: "box001", props: { "style.background-color": { token: "tkPrim1" }, "layout.gap": { token: "tkSpace" } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([{ code: "RAW_TOKEN_BOUND", id: "box001", key: "layout.gap" }]);
  });

  it("토큰 값과 참조를 검증한다", () => {
    expect(code(withTokens, tok("tkBad01", { name: "x.y", tokenType: "color", value: { value: 1, unit: "px" } }))).toBe("VALUE_INVALID");
    expect(code(withTokens, tok("tkBad01", { name: "x.y", tokenType: "dimension", value: { ref: "tkBlue1" } }))).toBe("TOKEN_TYPE_MISMATCH");
    expect(code(withTokens, tok("tkBad01", { name: "x.y", tokenType: "color", value: { ref: "nobody" } }))).toBe("UNKNOWN_OBJECT");
    expect(code(withTokens, tok("tkBad01", { name: "color.blue", tokenType: "color", value: blue }))).toBe("NAME_CONFLICT");
    expect(code(withTokens, tok("tkBad01", { name: "x.y", tokenType: "color" }))).toBe("VALUE_INVALID");
    expect(code(withTokens, tok("tkBad01", { name: "font.body", tokenType: "fontFamily", value: ["Pretendard"] }))).toBe("VALUE_INVALID");
    expect(code(withTokens, tok("tkFont1", { name: "font.body", tokenType: "fontFamily", value: ["Pretendard", "sans-serif"] }))).toBe(null);
  });

  it("컨텍스트 키를 검증한다", () => {
    expect(code(withTokens, { op: "set", id: "tkSpace", props: { "value@ctx:dark": { value: 8, unit: "px" } } })).toBe("CONDITION_TARGET_MISSING");
    expect(code(withTokens, { op: "set", id: "tkSpace", props: { "value@bp:bp0768": { value: 8, unit: "px" } } })).toBe("KEY_INVALID");
    expect(code(withTokens, { op: "set", id: "tkSpace", props: { variesBy: "nobody" } })).toBe("UNKNOWN_OBJECT");
  });

  it("variesBy를 바꾸면 이전 컨텍스트 값을 지운다", () => {
    const doc = ok(withTokens, { op: "set", id: "tkBlue1", props: { variesBy: "_mode", "value@ctx:dark": rgb(0, 0, 0.5) } });
    expect(Object.keys(doc.objects.tkBlue1).filter((k) => k.includes("@ctx"))).toEqual(["value@ctx:dark"]);
  });

  it("modifier 컨텍스트에서 빠진 값을 지운다", () => {
    const doc = ok(withTokens, { op: "set", id: "palette", props: { contexts: ["brand", "warm"] } });
    expect("value@ctx:mono" in doc.objects.tkBlue1).toBe(false);
    expect(code(withTokens, { op: "set", id: "palette", props: { contexts: ["a1", "b1"] } })).toBe("VALUE_INVALID");
  });

  it("모든 컨텍스트 조합에서 순환을 거부한다", () => {
    // mono × light 조합에서만 blue → primary → blue로 순환한다
    expect(code(withTokens, { op: "set", id: "tkBlue1", props: { "value@ctx:mono": { ref: "tkPrim1" } } })).toBe("TOKEN_CYCLE");
    expect(code(withTokens, { op: "set", id: "tkPrim1", props: { "value@ctx:dark": { ref: "tkBlue1" } } })).toBe(null);
    expect(code(withTokens, { op: "set", id: "tkBlue1", props: { value: { ref: "tkPrim1" } } })).toBe("TOKEN_CYCLE");
    expect(code(withTokens, { op: "set", id: "tkSpace", props: { value: { ref: "tkSpace" } } })).toBe("TOKEN_CYCLE");
  });

  it("쓰이는 토큰과 modifier는 지울 수 없다", () => {
    const bound = ok(withTokens, { op: "set", id: "box001", props: { "layout.gap": { token: "tkSpace" } } });
    expect(code(bound, { op: "delete", id: "tkSpace" })).toBe("TOKEN_IN_USE");
    expect(code(withTokens, { op: "delete", id: "tkBlue1" })).toBe("TOKEN_IN_USE");
    expect(code(withTokens, { op: "delete", id: "palette" })).toBe("TOKEN_IN_USE");
    expect(code(withTokens, { op: "delete", id: "tkPrim1" })).toBe(null);
  });

  it("바인딩 타입과 기본 제공 modifier를 검증한다", () => {
    expect(code(withTokens, { op: "set", id: "box001", props: { "layout.gap": { token: "tkBlue1" } } })).toBe("TOKEN_TYPE_MISMATCH");
    expect(code(withTokens, { op: "set", id: "box001", props: { "style.font-family": "Arial" } })).toBe("VALUE_INVALID");
    expect(code(withTokens, { op: "set", id: "_mode", props: { default: "dark" } })).toBe("STRUCTURE_LOCKED");
    expect(code(withTokens, { op: "create", id: "mode02", type: "modifier", parent: null, props: { name: "mode", contexts: ["a", "b"], default: "a" } })).toBe("NAME_CONFLICT");
  });
});

describe("component", () => {
  const px = (value: number) => ({ value, unit: "px" });
  const comp = ok(
    base,
    { op: "create", id: "button", type: "component", parent: null, placement: "last", props: { name: "Button", tag: "button" } },
    { op: "create", id: "tone01", type: "componentProp", parent: "button", props: { name: "tone", kind: "enum", options: ["primary", "danger"], default: "primary" } },
    { op: "create", id: "icon01", type: "componentProp", parent: "button", props: { name: "icon", kind: "boolean", default: "true" } },
    { op: "create", id: "label1", type: "text", parent: "button", placement: "last", props: { content: "확인" } },
    { op: "create", id: "glyph1", type: "image", parent: "button", placement: "last", props: { src: "a.svg" } },
    { op: "create", id: "inst01", type: "instance", parent: "sect01", placement: "last", props: { component: "button", "props.tone01": "danger" } },
  );
  const set = (id: string, props: Record<string, unknown>) => code(comp, { op: "set", id, props });

  it("컴포넌트·속성·인스턴스를 만든다", () => {
    expect(ids(comp, null)).toEqual(["frame1", "button"]);
    expect(ids(comp, "button")).toEqual(["label1", "glyph1"]);
    expect(comp.objects.inst01["props.tone01"]).toBe("danger");
  });

  it("변형·상태·컨테이너 쿼리 조건 키를 검증한다", () => {
    expect(set("label1", { "style.font-size@var:tone01=danger": px(20), "style.font-size@var:tone01=danger@state:hover": px(22) })).toBeNull();
    expect(set("glyph1", { "hidden@var:icon01=false": true, "size.width@cq:480": px(32) })).toBeNull();
    expect(set("button", { "style.padding-top@state:pressed": px(4) })).toBeNull();
    expect(set("label1", { "style.font-size@state:hover@var:tone01=danger": px(1) })).toBe("KEY_INVALID");
    expect(set("label1", { "style.font-size@cq:480@var:tone01=danger": px(1) })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("label1", { "hidden@state:hover": true })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("glyph1", { "src@var:icon01=false": "b.svg" })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("button", { "layout.gap@cq:480": px(1) })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("label1", { "style.font-size@bp:bpinit0768": px(1) })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("box001", { "style.font-size@var:tone01=danger": px(1) })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("label1", { "style.font-size@var:tone01=ghost": px(1) })).toBe("CONDITION_TARGET_MISSING");
  });

  it("componentProp을 검증한다", () => {
    const cp = (props: object) => code(comp, { op: "create", id: "size01", type: "componentProp", parent: "button", props } as Op);
    expect(cp({ name: "tone", kind: "boolean", default: "true" })).toBe("NAME_CONFLICT");
    expect(cp({ name: "size", kind: "enum", default: "sm" })).toBe("VALUE_INVALID");
    expect(cp({ name: "size", kind: "boolean", options: ["a"], default: "a" })).toBe("VALUE_INVALID");
    expect(cp({ name: "size", kind: "enum", options: ["sm"], default: "md" })).toBe("VALUE_INVALID");
    expect(code(comp, { op: "create", id: "size01", type: "componentProp", parent: "label1", props: { name: "s", kind: "boolean", default: "true" } })).toBe("INVALID_PARENT");
  });

  it("인스턴스 속성과 override를 검증한다", () => {
    expect(set("inst01", { "props.tone01": "ghost" })).toBe("VALUE_INVALID");
    expect(set("inst01", { "props.nobody": "x" })).toBe("CONDITION_TARGET_MISSING");
    expect(set("inst01", { "node.label1.content": "취소", "node.glyph1.hidden": true, "node.glyph1.src": "b.svg" })).toBeNull();
    expect(set("inst01", { "node.label1.src": "b.svg" })).toBe("KEY_NOT_ALLOWED");
    expect(set("inst01", { "node.button.hidden": true })).toBe("KEY_NOT_ALLOWED");
    expect(set("inst01", { "node.label1.style.font-size": px(9) })).toBe("KEY_NOT_ALLOWED");
    expect(set("inst01", { "node.box001.content": "x" })).toBe("CONDITION_TARGET_MISSING");
    expect(set("inst01", { "node.label1.content@bp:bpinit0768": "x" })).toBe("CONDITION_NOT_ALLOWED");
    expect(set("inst01", { component: "button" })).toBe("TYPE_IMMUTABLE");
  });

  it("토큰 바인딩 override는 원본이 바인딩한 키만 받는다", () => {
    const doc = ok(
      comp,
      { op: "create", id: "tkA001", type: "token", parent: null, props: { name: "a", tokenType: "color", value: { colorSpace: "srgb", components: [0, 0, 0] } } },
      { op: "create", id: "tkB001", type: "token", parent: null, props: { name: "b", tokenType: "color", value: { colorSpace: "srgb", components: [1, 1, 1] } } },
      { op: "set", id: "label1", props: { "style.color": { token: "tkA001" } } },
    );
    expect(run(doc, { op: "set", id: "inst01", props: { "node.label1.style.color": { token: "tkB001" } } }).ok).toBe(true);
    expect(code(doc, { op: "set", id: "inst01", props: { "node.label1.style.color": { colorSpace: "srgb", components: [1, 1, 1] } } })).toBe("VALUE_INVALID");
  });

  it("중첩 인스턴스 경로와 순환을 검증한다", () => {
    const doc = ok(
      comp,
      { op: "create", id: "card01", type: "component", parent: null, placement: "last" },
      { op: "create", id: "inst02", type: "instance", parent: "card01", placement: "last", props: { component: "button" } },
      { op: "create", id: "inst03", type: "instance", parent: "box001", placement: "last", props: { component: "card01", "node.inst02/label1.content": "더보기" } },
    );
    expect(doc.objects.inst03["node.inst02/label1.content"]).toBe("더보기");
    expect(code(doc, { op: "create", id: "inst04", type: "instance", parent: "button", placement: "last", props: { component: "card01" } })).toBe("TREE_CYCLE");
    expect(code(doc, { op: "create", id: "inst04", type: "instance", parent: "card01", placement: "last", props: { component: "card01" } })).toBe("TREE_CYCLE");
    expect(code(doc, { op: "delete", id: "button" })).toBe("COMPONENT_IN_USE");
    expect(code(doc, { op: "create", id: "box009", type: "container", parent: "inst01", placement: "last" })).toBe("INVALID_PARENT");
    const cut = ok(doc, { op: "delete", id: "inst02" });
    expect("node.inst02/label1.content" in cut.objects.inst03).toBe(false);
  });

  it("옵션·속성을 지우면 그것을 가리키는 키를 지운다", () => {
    const a = ok(comp, { op: "set", id: "label1", props: { "style.font-size@var:tone01=danger": px(20), "style.font-size@var:tone01=primary": px(16) } });
    const b = ok(a, { op: "set", id: "tone01", props: { options: ["primary", "ghost"] } });
    expect(Object.keys(b.objects.label1)).toContain("style.font-size@var:tone01=primary");
    expect(Object.keys(b.objects.label1)).not.toContain("style.font-size@var:tone01=danger");
    expect("props.tone01" in b.objects.inst01).toBe(false);
    const c = ok(a, { op: "delete", id: "tone01" });
    expect(Object.keys(c.objects.label1).some((k) => k.includes("@var"))).toBe(false);
  });

  it("루트를 옮기면 조건 키를 모두 지운다", () => {
    const a = ok(
      comp,
      { op: "set", id: "label1", props: { "style.font-size@var:tone01=danger": px(20), "style.color@state:hover": { colorSpace: "srgb", components: [1, 0, 0] } } },
      { op: "move", id: "label1", parent: "box001", placement: "last" },
    );
    expect(Object.keys(a.objects.label1).some((k) => k.includes("@"))).toBe(false);
  });

  it("detach는 변형과 override를 굳힌 일반 노드로 바꾼다", () => {
    const a = ok(
      comp,
      { op: "set", id: "label1", props: { "style.font-size": px(14), "style.font-size@var:tone01=danger": px(20), "style.font-size@state:hover": px(30) } },
      { op: "set", id: "inst01", props: { name: "삭제 버튼", "size.width": "fill", "node.label1.content": "삭제" } },
      { op: "detach", id: "inst01" },
    );
    expect(a.objects.inst01).toBeUndefined();
    const [rootId, root] = childrenOf(a.objects, "sect01").at(-1)!;
    expect(rootId).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(root).toMatchObject({ type: "container", tag: "button", name: "삭제 버튼", "size.width": "fill" });
    const [[, label], [, glyph]] = childrenOf(a.objects, rootId);
    expect(label).toEqual({ type: "text", parent: rootId, order: comp.objects.label1.order, content: "삭제", "style.font-size": px(20) });
    expect(glyph.src).toBe("a.svg");
    const again = run(a, { op: "set", id: rootId, props: { name: "x" } });
    expect(again.ok).toBe(true);
  });
});
