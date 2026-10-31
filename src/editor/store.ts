import { nanoid } from "nanoid";
import { create } from "zustand";
import type { Doc, Op, OpError, Result } from "@/model";
import { LocalSource } from "./source";

export type View = { x: number; y: number; zoom: number };

type State = {
  doc: Doc;
  selected: string | null;
  view: View;
  error: OpError | null;
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
  },
};

export const source = new LocalSource(initial);

export const useEditor = create<State>(() => ({
  doc: source.getDoc(),
  selected: null,
  view: { x: 40, y: 40, zoom: 1 },
  error: null,
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
