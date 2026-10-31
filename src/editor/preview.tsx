"use client";

import { Button, Dialog, Icon } from "@junhadex/core";
import { Check, Copy } from "lucide";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki/bundle/web";
import { useEditor } from "./store";

export function Preview() {
  const code = useEditor((s) => s.preview);
  return (
    <Dialog
      open={code !== null}
      onOpenChange={(open) => !open && useEditor.setState({ preview: null })}
      title="HTML 미리보기"
      className="w-[min(90vw,960px)] max-w-none"
    >
      {code !== null && <Code key={code} code={code} />}
    </Dialog>
  );
}

function Code({ code }: { code: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    codeToHtml(code, { lang: "html", theme: "github-light" }).then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [code]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={copy}>
          <Icon node={copied ? Check : Copy} /> {copied ? "복사됨" : "코드 복사"}
        </Button>
      </div>
      <div className="max-h-[60vh] overflow-auto rounded border border-border text-xs [&_pre]:p-3">
        {html ? (
          // shiki가 코드 문자열을 이스케이프한 마크업이다.
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>{code}</pre>
        )}
      </div>
    </div>
  );
}
