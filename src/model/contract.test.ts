import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyOps, type Doc, type Op } from ".";
import { KEYS, OBJ_TYPES, Tx } from "./schema";

// 계약 파일은 메타 저장소에 있다. `vitest run -u`로 다시 생성하고 diff를 검토한다.
const DIR = "../../../../docs/architecture/";

const strip = (s: Record<string, unknown>) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$schema"));

describe("JSON Schema", () => {
  it("trama-ops.schema.json", async () => {
    const props = (t: (typeof OBJ_TYPES)[number]) =>
      z.strictObject(Object.fromEntries(Object.entries(KEYS[t]).map(([k, s]) => [k, s.nullable()]))).partial();
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "trama-ops.schema.json",
      $defs: {
        Transaction: strip(z.toJSONSchema(Tx)),
        ...Object.fromEntries(OBJ_TYPES.map((t) => [`${t}Props`, strip(z.toJSONSchema(props(t)))])),
      },
    };
    await expect(JSON.stringify(schema, null, 2) + "\n").toMatchFileSnapshot(DIR + "trama-ops.schema.json");
  });
});

type Case = { name: string; doc: Doc; ops: unknown[] };

const empty: Doc = { schemaVersion: 1, objects: {} };
const base: Doc = {
  schemaVersion: 1,
  objects: {
    frame1: { type: "frame", parent: null, order: "a0", name: "Home" },
    sect01: { type: "section", parent: "frame1", order: "a0" },
    box001: { type: "container", parent: "sect01", order: "a0" },
    box002: { type: "container", parent: "box001", order: "a0" },
    txt001: { type: "text", parent: "sect01", order: "a1", content: "hello" },
  },
};

const create = (id: string, type: string, parent: string | null, placement: unknown, props?: object) =>
  ({ op: "create", id, type, parent, ...(placement !== undefined && { placement }), ...(props && { props }) }) as Op;

const GROUPS: Record<string, Case[]> = {
  create: [
    { name: "같은 트랜잭션에서 만든 노드를 바로 참조한다", doc: empty, ops: [
      create("frame1", "frame", null, "last", { name: "Home" }),
      create("sect01", "section", "frame1", "last"),
      create("box001", "container", "sect01", "last", { "layout.mode": "flex-row" }),
      create("txt001", "text", "box001", "first", { content: "a" }),
      create("txt002", "text", "box001", "last", { content: "b" }),
      create("txt003", "text", "box001", { after: "txt001" }, { content: "c" }),
      create("txt004", "text", "box001", { before: "txt001" }, { content: "d" }),
    ] },
    { name: "props의 null은 저장하지 않는다", doc: base, ops: [create("box003", "container", "sect01", "last", { name: null })] },
    { name: "중복 ID", doc: base, ops: [create("box001", "container", "sect01", "last")] },
    { name: "예약 ID", doc: base, ops: [create("_box01", "container", "sect01", "last")] },
    { name: "section은 frame 아래에만", doc: base, ops: [create("sect02", "section", "box001", "last")] },
    { name: "보드에는 frame만", doc: base, ops: [create("txt002", "text", null, "last")] },
    { name: "없는 부모", doc: base, ops: [create("txt002", "text", "nobody", "last")] },
    { name: "종류에 없는 키", doc: base, ops: [create("box003", "container", "sect01", "last", { content: "x" })] },
  ],
  set: [
    { name: "설정과 null 삭제", doc: base, ops: [
      { op: "set", id: "box001", props: { "layout.mode": "grid", "layout.columns": 3, "layout.gap": { value: 8.5, unit: "px" } } },
      { op: "set", id: "box001", props: { "layout.mode": null } },
    ] },
    { name: "절대 배치", doc: base, ops: [{ op: "set", id: "box002", props: { position: "absolute", x: -4, y: 12.25, w: 100, h: 0 } }] },
    { name: "type 변경", doc: base, ops: [{ op: "set", id: "box001", props: { type: "text" } }] },
    { name: "parent는 move로", doc: base, ops: [{ op: "set", id: "box001", props: { parent: "frame1" } }] },
    { name: "없는 BP를 가리키는 조건 키", doc: base, ops: [{ op: "set", id: "box001", props: { "layout.gap@bp:bp0001": { value: 4, unit: "px" } } }] },
    { name: "소수 다섯째 자리", doc: base, ops: [{ op: "set", id: "box001", props: { "size.width": { value: 1.23456, unit: "px" } } }] },
    { name: "frame에는 position이 없다", doc: base, ops: [{ op: "set", id: "frame1", props: { position: "absolute" } }] },
    { name: "없는 객체", doc: base, ops: [{ op: "set", id: "nobody", props: { name: "x" } }] },
  ],
  move: [
    { name: "같은 부모 안에서 순서 변경", doc: base, ops: [{ op: "move", id: "box001", parent: "sect01", placement: { after: "txt001" } }] },
    { name: "다른 부모로 이동", doc: base, ops: [{ op: "move", id: "box002", parent: "sect01", placement: "first" }] },
    { name: "자기 하위로 이동", doc: base, ops: [{ op: "move", id: "box001", parent: "box002", placement: "last" }] },
    { name: "기준 노드가 형제가 아님", doc: base, ops: [{ op: "move", id: "txt001", parent: "sect01", placement: { after: "box002" } }] },
    { name: "기준 노드가 자기 자신", doc: base, ops: [{ op: "move", id: "txt001", parent: "sect01", placement: { after: "txt001" } }] },
    { name: "없는 기준 노드", doc: base, ops: [{ op: "move", id: "txt001", parent: "sect01", placement: { before: "nobody" } }] },
  ],
  breakpoint: [
    { name: "BP 생성과 override", doc: base, ops: [
      { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { name: "Tablet", minWidth: 768 } },
      { op: "set", id: "box001", props: { "layout.mode@bp:bp0768": "flex-row", "hidden@bp:bp0768": true } },
    ] },
    { name: "BP에 placement", doc: base, ops: [{ op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", placement: "last", props: { minWidth: 768 } }] },
    { name: "노드에 placement 없음", doc: base, ops: [create("box003", "container", "sect01", undefined)] },
    { name: "minWidth 없는 BP", doc: base, ops: [{ op: "create", id: "bp0768", type: "breakpoint", parent: "frame1" }] },
    { name: "Frame minWidth 이하 BP", doc: base, ops: [{ op: "create", id: "bp0300", type: "breakpoint", parent: "frame1", props: { minWidth: 320 } }] },
    { name: "같은 minWidth BP", doc: base, ops: [
      { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
      { op: "create", id: "bp0769", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
    ] },
    { name: "BP를 받지 않는 키", doc: base, ops: [
      { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
      { op: "set", id: "txt001", props: { "content@bp:bp0768": "x" } },
    ] },
    { name: "조건 문법 오류", doc: base, ops: [{ op: "set", id: "box001", props: { "hidden@bp:x": true } }] },
    { name: "@state 조건", doc: base, ops: [{ op: "set", id: "box001", props: { "hidden@state:hover": true } }] },
    { name: "BP 삭제 시 override 정리", doc: base, ops: [
      { op: "create", id: "bp0768", type: "breakpoint", parent: "frame1", props: { minWidth: 768 } },
      { op: "set", id: "box001", props: { "hidden@bp:bp0768": true } },
      { op: "delete", id: "bp0768" },
    ] },
  ],
  token: [
    { name: "modifier·토큰 생성과 바인딩", doc: base, ops: [
      { op: "create", id: "palette", type: "modifier", parent: null, props: { name: "palette", contexts: ["brand", "mono"], default: "brand" } },
      { op: "create", id: "tkBlue1", type: "token", parent: null, props: { name: "color.blue", tokenType: "color", value: { colorSpace: "srgb", components: [0.2, 0.4, 1] }, variesBy: "palette", "value@ctx:mono": { colorSpace: "srgb", components: [0.5, 0.5, 0.5] } } },
      { op: "create", id: "tkPrim1", type: "token", parent: null, props: { name: "color.primary", tokenType: "color", value: { ref: "tkBlue1" }, variesBy: "_mode", "value@ctx:dark": { colorSpace: "srgb", components: [1, 1, 1] } } },
      { op: "set", id: "box001", props: { "style.background-color": { token: "tkPrim1" }, "style.color": { token: "tkBlue1" } } },
    ] },
    { name: "타입이 다른 참조", doc: base, ops: [
      { op: "create", id: "tkSpace", type: "token", parent: null, props: { name: "space.md", tokenType: "dimension", value: { value: 16, unit: "px" } } },
      { op: "create", id: "tkBlue1", type: "token", parent: null, props: { name: "color.blue", tokenType: "color", value: { ref: "tkSpace" } } },
    ] },
    { name: "순환 참조", doc: base, ops: [
      { op: "create", id: "tkA0001", type: "token", parent: null, props: { name: "a", tokenType: "number", value: 1 } },
      { op: "create", id: "tkB0001", type: "token", parent: null, props: { name: "b", tokenType: "number", value: { ref: "tkA0001" } } },
      { op: "set", id: "tkA0001", props: { value: { ref: "tkB0001" } } },
    ] },
    { name: "쓰이는 토큰 삭제", doc: base, ops: [
      { op: "create", id: "tkSpace", type: "token", parent: null, props: { name: "space.md", tokenType: "dimension", value: { value: 16, unit: "px" } } },
      { op: "set", id: "box001", props: { "layout.gap": { token: "tkSpace" } } },
      { op: "delete", id: "tkSpace" },
    ] },
    { name: "이름 중복", doc: base, ops: [
      { op: "create", id: "tkA0001", type: "token", parent: null, props: { name: "a", tokenType: "number", value: 1 } },
      { op: "create", id: "tkA0002", type: "token", parent: null, props: { name: "a", tokenType: "number", value: 2 } },
    ] },
    { name: "기본 제공 modifier 변경", doc: base, ops: [{ op: "set", id: "_mode", props: { default: "dark" } }] },
    { name: "일반 계열이 없는 fontFamily", doc: base, ops: [
      { op: "create", id: "tkFont1", type: "token", parent: null, props: { name: "font.body", tokenType: "fontFamily", value: ["Pretendard"] } },
    ] },
  ],
  delete: [{ name: "하위 노드를 함께 삭제", doc: base, ops: [{ op: "delete", id: "box001" }] }],
  transaction: [
    { name: "뒤 연산이 실패하면 전부 거부", doc: base, ops: [{ op: "delete", id: "box002" }, { op: "set", id: "box001", props: { "layout.mode": "block" } }] },
    { name: "알 수 없는 연산", doc: base, ops: [{ op: "delete", id: "box002" }, { op: "detach", id: "box001" }] },
    { name: "빈 연산 배열", doc: base, ops: [] },
  ],
};

describe("적합성 fixture", () => {
  for (const [group, cases] of Object.entries(GROUPS)) {
    it(group, async () => {
      const out = cases.map(({ name, doc, ops }) => {
        const tx = { txId: "tx1", actor: "user:test", ops };
        const r = applyOps(doc, tx);
        if (r.ok) return { name, doc, tx, expect: { ok: true, doc: r.doc, warnings: r.warnings } };
        const { code, opIndex, id, key } = r.error;
        return { name, doc, tx, expect: { ok: false, error: { code, opIndex, id, key } } };
      });
      await expect(JSON.stringify({ cases: out }, null, 2) + "\n").toMatchFileSnapshot(
        `${DIR}trama-ops-conformance/${group}.json`,
      );
    });
  }
});
