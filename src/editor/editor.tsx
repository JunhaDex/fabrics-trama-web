"use client";

export function Editor() {
  return (
    <div className="grid h-screen grid-cols-[240px_1fr_280px] grid-rows-[44px_1fr]">
      <header className="col-span-3 border-b border-border bg-surface-raised" />
      <aside className="border-r border-border bg-surface-raised" />
      <main className="bg-surface" />
      <aside className="border-l border-border bg-surface-raised" />
    </div>
  );
}
