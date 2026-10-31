"use client";

import { Button, Dialog, Icon } from "@junhadex/core";
import { Check, Copy } from "lucide";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki/bundle/web";
import { useEditor, type Code } from "./store";

export function Preview() {
  const preview = useEditor((s) => s.preview);
  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => !open && useEditor.setState({ preview: null })}
      title={preview?.title ?? ""}
      className="w-[min(90vw,960px)] max-w-none"
    >
      {preview && (
        <div className="flex flex-col gap-4">
          {preview.parts.map((p) => (
            <Block key={p.label + p.code} part={p} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function Block({ part }: { part: Code }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    codeToHtml(part.code, { lang: part.lang, theme: "github-light" }).then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [part]);

  const copy = async () => {
    await navigator.clipboard.writeText(part.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{part.label}</h3>
        <Button size="sm" variant="secondary" onClick={copy}>
          <Icon node={copied ? Check : Copy} /> {copied ? "복사됨" : `${part.label} 복사`}
        </Button>
      </div>
      <div className="max-h-[40vh] overflow-auto rounded border border-border text-xs [&_pre]:p-3">
        {html ? (
          // shiki가 코드 문자열을 이스케이프한 마크업이다.
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>{part.code}</pre>
        )}
      </div>
    </section>
  );
}
