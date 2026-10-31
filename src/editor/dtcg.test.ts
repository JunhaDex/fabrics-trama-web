import { describe, expect, it } from "vitest";
import { applyOps, tokensOf, type Doc, type Op } from "@/model";
import { fromDtcg, toDtcg } from "./dtcg";

const run = (doc: Doc, ops: Op[]) => {
  const r = applyOps(doc, { txId: "t", actor: "user:test", ops });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.doc;
};
const rgb = (r: number, g: number, b: number) => ({ colorSpace: "srgb", components: [r, g, b] });
const empty: Doc = { schemaVersion: 1, objects: {} };

const src = run(empty, [
  { op: "create", id: "palette", type: "modifier", parent: null, props: { name: "palette", contexts: ["brand", "mono"], default: "brand" } },
  { op: "create", id: "tkBlue1", type: "token", parent: null, props: { name: "color.blue", tokenType: "color", value: rgb(0.2, 0.4, 1), variesBy: "palette", "value@ctx:mono": rgb(0.5, 0.5, 0.5) } },
  { op: "create", id: "tkBlue5", type: "token", parent: null, props: { name: "color.blue.500", tokenType: "color", value: rgb(0, 0, 1) } },
  { op: "create", id: "tkPrim1", type: "token", parent: null, props: { name: "color.primary", tokenType: "color", value: { ref: "tkBlue1" }, variesBy: "_mode", "value@ctx:dark": { ref: "tkBlue5" }, description: "주요 동작", deprecated: true } },
  { op: "create", id: "tkFont1", type: "token", parent: null, props: { name: "font.body", tokenType: "fontFamily", value: ["Pretendard", "sans-serif"] } },
]);

let n = 0;
const newId = () => `newid${String(++n).padStart(4, "0")}`;
const strip = (doc: Doc) => tokensOf(doc.objects).map(([, t]) => ({ ...t }) as Record<string, unknown>);

describe("DTCG", () => {
  const out = toDtcg(src.objects);

  it("그룹이기도 한 토큰 이름은 $root로 내보내고 참조도 $root를 가리킨다", () => {
    const blue = (out.tokens.color as Record<string, Record<string, unknown>>).blue;
    expect(blue.$root).toMatchObject({ $type: "color" });
    expect((out.tokens.color as Record<string, Record<string, unknown>>).primary.$value).toBe("{color.blue.$root}");
    expect(out.resolver.version).toBe("2025.10");
  });

  it("내보낸 것을 빈 문서로 가져오면 같은 토큰이 된다", () => {
    const { ops, skipped } = fromDtcg({}, out.tokens, out.resolver, newId);
    expect(skipped).toEqual([]);
    const doc = run(empty, ops);
    const mod = Object.entries(doc.objects).find(([, o]) => o.type === "modifier")!;
    expect(mod[1]).toMatchObject({ name: "palette", contexts: ["brand", "mono"], default: "brand" });
    const back = strip(doc).map((t) => (t.variesBy === mod[0] ? { ...t, variesBy: "palette" } : t));
    expect(back).toEqual(strip(src));
  });

  it("fontWeight 별칭과 지원하지 않는 타입을 처리한다", () => {
    const { ops, skipped } = fromDtcg({}, { font: { $type: "fontWeight", bold: { $value: "bold" } }, shadow: { $type: "shadow", sm: { $value: {} } } }, null, newId);
    expect(skipped).toEqual(["shadow.sm (shadow)"]);
    const doc = run(empty, ops);
    expect(tokensOf(doc.objects)[0][1].value).toBe(700);
  });
});
