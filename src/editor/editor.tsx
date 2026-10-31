"use client";

import { Button, Icon } from "@junhadex/core";
import { Eye, FileJson, Palette, Redo2, Undo2, Upload } from "lucide";
import { useEffect } from "react";
import { Board } from "./board";
import { exportJson, importJson, previewHtml } from "./io";
import { isTyping } from "./keys";
import { Layers } from "./layers";
import { load, save } from "./persist";
import { Preview } from "./preview";
import { Tokens } from "./tokens";
import { Props } from "./props";
import { apply, select, source, useEditor } from "./store";
import { modifiersOf } from "@/model";

export function Editor() {
  const error = useEditor((s) => s.error);
  const doc = useEditor((s) => s.doc);
  const ctx = useEditor((s) => s.ctx);

  useEffect(() => {
    let ready = false;
    let timer: ReturnType<typeof setTimeout>;
    load().then((doc) => {
      if (doc) source.replace(doc);
      ready = true;
    });
    const unsub = source.subscribe(() => {
      if (!ready) return;
      clearTimeout(timer);
      timer = setTimeout(() => save(source.getDoc()), 300);
    });
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || useEditor.getState().preview !== null || useEditor.getState().tokensOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = useEditor.getState().selected;
      if (mod && e.key.toLowerCase() === "z") {
        if (e.shiftKey) source.redo();
        else source.undo();
      } else if (mod && e.key.toLowerCase() === "y") source.redo();
      else if (sel && (e.key === "Delete" || e.key === "Backspace")) apply({ op: "delete", id: sel });
      else if (e.key === "Escape") select(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unsub();
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="grid h-screen grid-cols-[240px_1fr_280px] grid-rows-[44px_1fr]">
      <header className="col-span-3 flex items-center gap-1 border-b border-border bg-surface-raised px-2">
        <span className="mr-3 font-semibold">trama</span>
        <Button size="sm" variant="ghost" aria-label="실행 취소" onClick={() => source.undo()}>
          <Icon node={Undo2} />
        </Button>
        <Button size="sm" variant="ghost" aria-label="다시 실행" onClick={() => source.redo()}>
          <Icon node={Redo2} />
        </Button>
        {modifiersOf(doc.objects).map(([mid, m]) => (
          <label key={mid} className="ml-2 flex items-center gap-1 text-xs text-on-surface-muted">
            {m.name as string}
            <select
              className="h-7 rounded border border-border bg-surface px-1 text-xs text-on-surface"
              value={ctx[m.name as string] ?? (m.default as string)}
              onChange={(e) => useEditor.setState({ ctx: { ...ctx, [m.name as string]: e.target.value } })}
            >
              {(m.contexts as string[]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ))}
        <p role="status" className="flex-1 truncate text-center text-xs text-danger">
          {error && `${error.code}: ${error.message}`}
        </p>
        <Button size="sm" variant="ghost" onClick={() => useEditor.setState({ tokensOpen: true })}>
          <Icon node={Palette} /> 토큰
        </Button>
        <Button size="sm" variant="ghost" onClick={previewHtml}>
          <Icon node={Eye} /> HTML 미리보기
        </Button>
        <Button size="sm" variant="ghost" onClick={exportJson}>
          <Icon node={FileJson} /> JSON 저장
        </Button>
        <Button size="sm" variant="ghost" onClick={importJson}>
          <Icon node={Upload} /> JSON 열기
        </Button>
      </header>
      <aside className="min-h-0 border-r border-border bg-surface-raised">
        <Layers />
      </aside>
      <main className="min-h-0">
        <Board />
      </main>
      <aside className="min-h-0 overflow-auto border-l border-border bg-surface-raised">
        <Props />
      </aside>
      <Preview />
      <Tokens />
    </div>
  );
}
