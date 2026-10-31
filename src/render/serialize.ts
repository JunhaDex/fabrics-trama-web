import type { El, Page } from "./build";

type Opts = { dataId: boolean; dataLayout: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

function el(e: El, opts: Opts, depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = [...e.attrs];
  if (opts.dataId) attrs.push(["data-id", e.id]);
  if (opts.dataLayout && e.layout) attrs.push(["data-layout", e.layout]);
  const open = `<${e.tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}>`;
  if (e.tag === "img") return pad + open;
  if (e.text !== null) return `${pad}${open}${esc(e.text)}</${e.tag}>`;
  if (!e.children.length) return `${pad}${open}</${e.tag}>`;
  return [pad + open, ...e.children.map((c) => el(c, opts, depth + 1)), `${pad}</${e.tag}>`].join("\n");
}

export function css(page: Page): string {
  return page.rules.map((r) => `${r.sel} {\n${r.decls.map(([p, v]) => `  ${p}: ${v};\n`).join("")}}\n`).join("\n");
}

function html(page: Page, head: string, opts: Opts): string {
  const viewport = `width=device-width, initial-scale=1${page.safeArea ? ", viewport-fit=cover" : ""}`;
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    `<meta name="viewport" content="${viewport}">`,
    `<title>${esc(page.title)}</title>`,
    head,
    "</head>",
    el(page.body, opts, 0),
    "</html>",
    "",
  ].join("\n");
}

/** 내보내기용 HTML과 CSS. HTML은 같은 위치의 style.css를 참조한다. */
export function toExport(page: Page): { html: string; css: string } {
  return {
    html: html(page, '<link rel="stylesheet" href="style.css">', { dataId: false, dataLayout: false }),
    css: css(page),
  };
}

/** 편집기 iframe의 srcdoc. CSS를 인라인하고 요소마다 data-id를 붙인다. */
export function toSrcdoc(page: Page): string {
  return html(page, `<style>\n${css(page)}</style>`, { dataId: true, dataLayout: false });
}

/** AI 읽기용 body 마크업. CSS 없이 data-id와 data-layout을 붙인다. */
export function toAnnotated(page: Page): string {
  return el(page.body, { dataId: true, dataLayout: true }, 0) + "\n";
}
