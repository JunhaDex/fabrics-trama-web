import { applyOps, breakpointsOf, childrenOf, frameOf, type Doc, type Objects, type Op, type Result } from "@/model";
import { build, toPreview } from "@/render";
import { source, useEditor } from "./store";

/** 선택한 노드가 속한 Frame(선택이 없으면 첫 Frame)의 내보내기 HTML을 미리보기 팝업으로 연다. */
export function previewHtml() {
  const { doc, selected } = useEditor.getState();
  const frame = selected ? frameOf(doc.objects, selected) : childrenOf(doc.objects, null)[0]?.[0];
  if (frame) useEditor.setState({ preview: toPreview(build(doc, frame)) });
}

export function exportJson() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(source.getDoc(), null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "trama.json";
  a.click();
  URL.revokeObjectURL(url);
}

/** 문서 JSON 파일을 열어, 모든 객체를 apply_ops로 다시 만들어 검증한 뒤 현재 문서를 바꾼다. */
export function importJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const text = await input.files?.[0]?.text();
    if (!text) return;
    let objects: Objects;
    try {
      objects = (JSON.parse(text) as Doc).objects;
      if (typeof objects !== "object" || objects === null) throw new Error();
    } catch {
      useEditor.setState({ error: { code: "SCHEMA_INVALID", opIndex: null, id: null, key: null, message: "문서 JSON이 아니다" } });
      return;
    }
    const r = rebuild(objects);
    useEditor.setState({ error: r.ok ? null : r.error, selected: null });
    if (r.ok) source.replace(r.doc);
  };
  input.click();
}

function rebuild(objects: Objects): Result {
  const ops: Op[] = [];
  const props = (o: Objects[string]) => Object.fromEntries(Object.entries(o).filter(([k]) => !["type", "parent", "order"].includes(k)));
  const walk = (parent: string | null) => {
    for (const [id, o] of childrenOf(objects, parent)) {
      ops.push({ op: "create", id, type: o.type, parent, placement: "last", props: props(o) });
      // 자식의 @bp 키가 BP를 가리키므로 Frame을 만든 직후 BP를 먼저 만든다.
      if (parent === null)
        for (const [bid, bp] of breakpointsOf(objects, id)) ops.push({ op: "create", id: bid, type: "breakpoint", parent: id, props: props(bp) });
      walk(id);
    }
  };
  walk(null);
  return applyOps({ schemaVersion: 1, objects: {} }, { txId: crypto.randomUUID(), actor: "user:local", ops });
}
