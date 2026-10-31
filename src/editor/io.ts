import { applyOps, breakpointsOf, childrenOf, componentPropsOf, frameOf, type Doc, type Obj, type Objects, type Op, type Placement, type Result } from "@/model";
import { build, toPreview, toSnippet } from "@/render";
import { source, useEditor } from "./store";

/**
 * 미리보기 팝업을 연다. Frame을 선택했거나 선택이 없으면(첫 Frame) 전체 HTML 문서를,
 * 그 밖의 노드를 선택했으면 그 노드의 HTML·CSS 조각을 보여준다. 컴포넌트 루트는 기본 변형의 조각이다.
 */
export function previewHtml() {
  const { doc, selected } = useEditor.getState();
  const root = selected ? frameOf(doc.objects, selected) : childrenOf(doc.objects, null).find(([, o]) => o.type === "frame")?.[0];
  if (!root) return;
  const page = build(doc, root);
  const snippet = selected && (selected !== root || doc.objects[root].type === "component") ? toSnippet(page, selected) : null;
  useEditor.setState({
    preview: snippet
      ? {
          title: "선택 영역 코드",
          parts: [
            { label: "HTML", lang: "html", code: snippet.html },
            { label: "CSS", lang: "css", code: snippet.css },
          ],
        }
      : { title: "HTML 미리보기", parts: [{ label: "HTML 문서", lang: "html", code: toPreview(page) }] },
  });
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
  const late: Op[] = [];
  const props = (o: Obj, keep: (k: string) => boolean = () => true) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => !["type", "parent", "order"].includes(k) && keep(k)));
  const create = (id: string, o: Obj, keep?: (k: string) => boolean, placement?: Placement): Op => ({
    op: "create",
    id,
    type: o.type,
    parent: o.parent,
    ...(placement && { placement }),
    props: props(o, keep),
  });
  for (const [id, o] of Object.entries(objects)) if (o.type === "modifier") ops.push(create(id, o));
  // 토큰 참조는 이미 있는 토큰만 가리킬 수 있으므로 참조 대상부터 만든다.
  const made = new Set<string>();
  const token = (id: string) => {
    if (made.has(id) || objects[id]?.type !== "token") return;
    made.add(id);
    for (const v of Object.values(objects[id])) if (v && typeof v === "object" && "ref" in v) token((v as { ref: string }).ref);
    ops.push(create(id, objects[id]));
  };
  for (const id of Object.keys(objects)) token(id);
  // 인스턴스와 @var 키가 가리킬 컴포넌트 루트·속성과 @bp 키가 가리킬 BP를 트리보다 먼저 만든다.
  // 컴포넌트 루트의 조건 키와 인스턴스 override는 트리를 다 만든 뒤 쓴다.
  const roots = childrenOf(objects, null);
  for (const [id, o] of roots) {
    if (o.type === "frame") {
      ops.push(create(id, o, undefined, "last"));
      for (const [bid, bp] of breakpointsOf(objects, id)) ops.push(create(bid, bp));
      continue;
    }
    ops.push(create(id, o, (k) => !k.includes("@"), "last"));
    for (const [cid, cp] of componentPropsOf(objects, id)) ops.push(create(cid, cp));
    const conds = props(o, (k) => k.includes("@"));
    if (Object.keys(conds).length) late.push({ op: "set", id, props: conds });
  }
  const walk = (parent: string) => {
    for (const [id, o] of childrenOf(objects, parent)) {
      if (o.type === "instance") {
        ops.push(create(id, o, (k) => !k.startsWith("node."), "last"));
        const over = props(o, (k) => k.startsWith("node."));
        if (Object.keys(over).length) late.push({ op: "set", id, props: over });
      } else ops.push(create(id, o, undefined, "last"));
      walk(id);
    }
  };
  for (const [id] of roots) walk(id);
  return applyOps({ schemaVersion: 1, objects: {} }, { txId: crypto.randomUUID(), actor: "user:local", ops: [...ops, ...late] });
}
