import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyOps, type Doc, type Op } from ".";
import { KEYS, NODE_TYPES, Tx } from "./schema";

// 계약 파일은 메타 저장소에 있다. `vitest run -u`로 다시 생성하고 diff를 검토한다.
const DIR = "../../../../docs/architecture/";

const strip = (s: Record<string, unknown>) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$schema"));

describe("JSON Schema", () => {
  it("trama-ops.schema.json", async () => {
    const props = (t: (typeof NODE_TYPES)[number]) =>
      z.strictObject(Object.fromEntries(Object.entries(KEYS[t]).map(([k, s]) => [k, s.nullable()]))).partial();
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "trama-ops.schema.json",
      $defs: {
        Transaction: strip(z.toJSONSchema(Tx)),
        ...Object.fromEntries(NODE_TYPES.map((t) => [`${t}Props`, strip(z.toJSONSchema(props(t)))])),
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
  ({ op: "create", id, type, parent, placement, ...(props && { props }) }) as Op;

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
    { name: "조건 키는 아직 허용하지 않는다", doc: base, ops: [{ op: "set", id: "box001", props: { "layout.gap@bp:bp0001": { value: 4, unit: "px" } } }] },
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
        if (r.ok) return { name, doc, tx, expect: { ok: true, doc: r.doc } };
        const { code, opIndex, id, key } = r.error;
        return { name, doc, tx, expect: { ok: false, error: { code, opIndex, id, key } } };
      });
      await expect(JSON.stringify({ cases: out }, null, 2) + "\n").toMatchFileSnapshot(
        `${DIR}trama-ops-conformance/${group}.json`,
      );
    });
  }
});
