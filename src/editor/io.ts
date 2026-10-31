import { applyOps, childrenOf, type Doc, type Objects, type Op, type Result } from "@/model";
import { build, toExport } from "@/render";
import { frameOf } from "./geometry";
import { source, useEditor } from "./store";

// File System Access API는 Chromium 전용이며 TypeScript DOM 타입에 아직 없다.
type DirHandle = { getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<WritableStream & { write(d: string): Promise<void>; close(): Promise<void> }> }> };
declare global {
  interface Window {
    showDirectoryPicker(o?: { mode: "readwrite" }): Promise<DirHandle>;
  }
}

/** 선택한 노드가 속한 Frame(선택이 없으면 첫 Frame)을 index.html과 style.css로 고른 폴더에 쓴다. */
export async function exportHtml() {
  const { doc, selected } = useEditor.getState();
  const frame = selected ? frameOf(doc, selected) : childrenOf(doc.objects, null)[0]?.[0];
  if (!frame) return;
  const { html, css } = toExport(build(doc, frame));
  const dir = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
  if (!dir) return;
  for (const [name, text] of [["index.html", html], ["style.css", css]]) {
    const file = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await file.write(text);
    await file.close();
  }
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
  const walk = (parent: string | null) => {
    for (const [id, o] of childrenOf(objects, parent)) {
      const props = Object.fromEntries(Object.entries(o).filter(([k]) => !["type", "parent", "order"].includes(k)));
      ops.push({ op: "create", id, type: o.type, parent, placement: "last", props });
      walk(id);
    }
  };
  walk(null);
  return applyOps({ schemaVersion: 1, objects: {} }, { txId: crypto.randomUUID(), actor: "user:local", ops });
}
