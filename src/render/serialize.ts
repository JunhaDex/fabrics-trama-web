import type { El, Media, Page, Rule } from "./build";

type Opts = { dataId: boolean; dataLayout: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

function el(e: El, opts: Opts, depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = [...e.attrs];
  if (opts.dataId && e.id) attrs.push(["data-id", e.id]);
  if (opts.dataLayout && e.layout) attrs.push(["data-layout", e.layout]);
  const open = `<${e.tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}>`;
  if (e.tag === "img" || e.tag === "source") return pad + open;
  if (e.text !== null) return `${pad}${open}${esc(e.text)}</${e.tag}>`;
  if (!e.children.length) return `${pad}${open}</${e.tag}>`;
  return [pad + open, ...e.children.map((c) => el(c, opts, depth + 1)), `${pad}</${e.tag}>`].join("\n");
}

const rule = (r: Rule, pad: string) => `${pad}${r.sel} {\n${r.decls.map(([p, v]) => `${pad}  ${p}: ${v};\n`).join("")}${pad}}\n`;

const sheet = (rules: Rule[], media: Media[]) =>
  [
    ...rules.map((r) => rule(r, "")),
    ...media.map((m) => `${m.at} {\n${m.rules.map((r) => rule(r, "  ")).join("\n")}}\n`),
  ].join("\n");

export const css = (page: Page) => sheet(page.rules, page.media);

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

/** 내보내기 결과를 한 파일로 보는 미리보기. CSS를 인라인하며 data 속성을 붙이지 않는다. */
export function toPreview(page: Page): string {
  return html(page, `<style>\n${css(page)}</style>`, { dataId: false, dataLayout: false });
}

/**
 * 노드 하나와 그 하위 노드의 HTML·CSS 조각. CSS는 조각 안 요소의 클래스만으로 이루어진 규칙(`@media`·`@container` 안 포함)과
 * 토큰 규칙만 담고 페이지 전체의 리셋 규칙은 뺀다.
 * Frame 안에 없는 ID면 null이다.
 */
export function toSnippet(page: Page, id: string): { html: string; css: string } | null {
  const find = (e: El): El | null => {
    for (const c of e.children) {
      if (c.id === id || (c.tag === "picture" && c.children.some((x) => x.id === id))) return c;
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  const root = find(page.body);
  if (!root) return null;
  const names = new Set<string>();
  const walk = (e: El) => {
    names.add(e.tag);
    for (const c of e.attrs.find(([k]) => k === "class")?.[1].split(" ") ?? []) names.add(`.${c}`);
    e.children.forEach(walk);
  };
  walk(root);
  const keep = (r: Rule) => {
    if (r.sel.startsWith(":root")) return true;
    const classes = r.sel.match(/\.[A-Za-z0-9_-]+/g);
    return classes ? classes.every((c) => names.has(c)) : names.has(r.sel);
  };
  return {
    html: el(root, { dataId: false, dataLayout: false }, 0) + "\n",
    css: sheet(
      page.rules.filter(keep),
      page.media.map((m) => ({ ...m, rules: m.rules.filter(keep) })).filter((m) => m.rules.length),
    ),
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
