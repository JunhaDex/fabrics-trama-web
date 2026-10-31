import { nanoid } from "nanoid";
import { create } from "zustand";
import type { Doc, Op, OpError, Result } from "@/model";
import { LocalSource } from "./source";

export type View = { x: number; y: number; zoom: number };
export type Code = { label: string; lang: "html" | "css" | "json"; code: string };
export type Preview = { title: string; parts: Code[] };
/** 컴포넌트 보드 미리보기와 편집 대상. var·state를 고르면 그 조건 키로 쓰고, cqs는 아직 키가 없는 컨테이너 쿼리 기준도 담는다. */
export type CompView = { var: [prop: string, option: string] | null; state: string | null; cqs: number[] };

type State = {
  doc: Doc;
  selected: string | null;
  view: View;
  error: OpError | null;
  preview: Preview | null;
  clipped: Record<string, string[]>;
  heights: Record<string, number>;
  /** modifier 이름 → 미리보기 컨텍스트. 문서가 아니라 미리보기 상태다. */
  ctx: Record<string, string>;
  tokensOpen: boolean;
  comp: Record<string, CompView>;
};

// 서버 렌더와 첫 클라이언트 렌더가 같아야 하므로 초기 Frame ID는 고정값이다.
const initial: Doc = {
  schemaVersion: 1,
  objects: {
    frame0000: {
      type: "frame",
      parent: null,
      order: "a0",
      name: "Frame 1",
      boardX: 0,
      boardY: 0,
      previewWidth: 390,
      previewHeight: 844,
    },
    bpinit0768: { type: "breakpoint", parent: "frame0000", name: "Tablet", minWidth: 768 },
    bpinit1280: { type: "breakpoint", parent: "frame0000", name: "Desktop", minWidth: 1280 },
  },
};

export const source = new LocalSource(initial);

export const useEditor = create<State>(() => ({
  doc: source.getDoc(),
  selected: null,
  view: { x: 40, y: 40, zoom: 1 },
  error: null,
  preview: null,
  clipped: {},
  heights: {},
  ctx: {},
  tokensOpen: false,
  comp: {},
}));

source.subscribe(() => {
  const doc = source.getDoc();
  useEditor.setState((s) => ({ doc, selected: s.selected && doc.objects[s.selected] ? s.selected : null }));
});

export function apply(...ops: Op[]): Result {
  const r = source.apply(ops);
  useEditor.setState({ error: r.ok ? null : r.error });
  return r;
}

export const select = (selected: string | null) => useEditor.setState({ selected });
export const newId = () => nanoid();

export const compView = (id: string): CompView => useEditor.getState().comp[id] ?? { var: null, state: null, cqs: [] };
export const setCompView = (id: string, v: Partial<CompView>) =>
  useEditor.setState((s) => ({ comp: { ...s.comp, [id]: { ...compView(id), ...v } } }));
