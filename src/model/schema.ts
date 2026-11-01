import { z } from "zod";

export const Id = z.string().regex(/^(?:[A-Za-z0-9_-]{6,32}|_[a-z]{1,31})$/);

// refine은 JSON Schema로 변환되지 않으므로 description으로 계약에 남긴다.
const num4 = z
  .number()
  .finite()
  .refine((n) => Math.round(n * 1e4) / 1e4 === n)
  .meta({ description: "소수 넷째 자리까지" });

export const Dimension = z.strictObject({
  value: num4,
  unit: z.enum(["px", "rem"]),
});

const unit = num4.min(0).max(1);

export const Color = z.strictObject({
  colorSpace: z.literal("srgb"),
  components: z.tuple([unit, unit, unit]),
  alpha: unit.optional(),
});

export const TOKEN_TYPES = ["color", "dimension", "fontFamily", "fontWeight", "number"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

const GENERIC = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong"];

/** 토큰 타입별 원시값 형식. 참조(`{ ref }`)는 별도로 받는다. */
export const TOKEN_VALUE: Record<TokenType, z.ZodType> = {
  color: Color,
  dimension: Dimension,
  fontFamily: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .refine((v) => GENERIC.includes(Array.isArray(v) ? v[v.length - 1] : v))
    .meta({ description: "마지막 항목은 일반 계열(sans-serif 등)" }),
  fontWeight: z.number().int().min(1).max(1000),
  number: z.number().finite(),
};

export const TokenRef = z.strictObject({ ref: Id });
export const TokenBinding = z.strictObject({ token: Id });

/** 토큰을 바인딩할 수 있는 노드 키와 그 키가 받는 토큰 타입. */
export const BIND_TYPE: Record<string, TokenType> = {};
const bind = <T extends z.ZodType>(key: string, type: TokenType, s: T) => {
  BIND_TYPE[key] = type;
  return z.union([s, TokenBinding]);
};

const intMin1 = z.number().int().min(1);
const sizeOf = (key: string) => bind(key, "dimension", z.union([z.enum(["fill", "hug"]), Dimension]));
const dim = (key: string) => bind(key, "dimension", Dimension);

export const NODE_TYPES = ["frame", "component", "section", "container", "text", "image", "instance"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const OBJ_TYPES = [...NODE_TYPES, "breakpoint", "componentProp", "modifier", "token"] as const;
export type ObjType = (typeof OBJ_TYPES)[number];

const common = {
  name: z.string(),
  hidden: z.boolean(),
};

const layout = {
  "layout.mode": z.enum(["flex-row", "flex-column", "grid"]),
  "layout.gap": dim("layout.gap"),
  "layout.rowGap": dim("layout.rowGap"),
  "layout.justify": z.enum(["start", "center", "end", "space-between", "space-around", "space-evenly"]),
  "layout.align": z.enum(["start", "center", "end", "stretch", "baseline"]),
  "layout.wrap": z.boolean(),
  "layout.columns": intMin1,
  "layout.clip": z.boolean(),
};

const child = {
  "size.width": sizeOf("size.width"),
  "size.height": sizeOf("size.height"),
  "size.minWidth": dim("size.minWidth"),
  "size.maxWidth": dim("size.maxWidth"),
  "size.minHeight": dim("size.minHeight"),
  "size.maxHeight": dim("size.maxHeight"),
  "grid.colStart": intMin1,
  "grid.colSpan": intMin1,
  "grid.rowStart": intMin1,
  "grid.rowSpan": intMin1,
  position: z.enum(["static", "absolute"]),
  x: num4,
  y: num4,
  w: num4.min(0),
  h: num4.min(0),
};

const text = {
  "style.color": bind("style.color", "color", Color),
  "style.font-size": dim("style.font-size"),
  "style.font-weight": bind("style.font-weight", "fontWeight", z.number().int().min(100).max(900).multipleOf(100)),
  "style.font-family": bind("style.font-family", "fontFamily", z.never()),
};

const box = {
  "style.background-color": bind("style.background-color", "color", Color),
  "style.padding-top": dim("style.padding-top"),
  "style.padding-right": dim("style.padding-right"),
  "style.padding-bottom": dim("style.padding-bottom"),
  "style.padding-left": dim("style.padding-left"),
  "style.border-width": dim("style.border-width"),
  "style.border-style": z.enum(["none", "solid", "dashed", "dotted"]),
  "style.border-color": bind("style.border-color", "color", Color),
  "style.border-radius": dim("style.border-radius"),
};

const tag = (tags: [string, ...string[]]) => ({ tag: z.enum(tags) });
const CONTAINER_TAGS: [string, ...string[]] = ["div", "ul", "ol", "li", "figure", "a", "button", "form", "label"];
const ident = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const KEYS: Record<ObjType, Record<string, z.ZodType>> = {
  breakpoint: {
    name: z.string(),
    minWidth: z.number().int().positive(),
  },
  componentProp: {
    name: ident,
    kind: z.enum(["enum", "boolean"]),
    options: z.array(ident).min(1).refine((a) => new Set(a).size === a.length).meta({ description: "enum만. 중복 없음" }),
    default: z.string(),
  },
  modifier: {
    name: ident,
    contexts: z.array(ident).min(2).refine((a) => new Set(a).size === a.length),
    default: z.string(),
  },
  token: {
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)*$/),
    tokenType: z.enum(TOKEN_TYPES),
    value: z.unknown().meta({ description: "tokenType의 원시값 또는 { ref: 토큰 ID }" }),
    variesBy: Id,
    description: z.string(),
    deprecated: z.boolean(),
  },
  frame: {
    ...common,
    ...layout,
    boardX: z.number().finite(),
    boardY: z.number().finite(),
    previewWidth: z.number().finite().positive(),
    previewHeight: z.number().finite().positive(),
    baseLabel: z.string(),
    minWidth: z.number().finite().positive(),
    safeArea: z.boolean(),
    ...text,
    "style.background-color": bind("style.background-color", "color", Color),
  },
  component: {
    ...common,
    ...layout,
    ...text,
    ...box,
    ...tag(CONTAINER_TAGS),
    boardX: z.number().finite(),
    boardY: z.number().finite(),
    previewWidth: z.number().finite().positive(),
    previewHeight: z.number().finite().positive(),
  },
  section: {
    ...common,
    ...layout,
    ...child,
    ...text,
    ...box,
    ...tag(["section", "header", "footer", "nav", "main", "aside", "article"]),
  },
  container: {
    ...common,
    ...layout,
    ...child,
    ...text,
    ...box,
    ...tag(CONTAINER_TAGS),
  },
  text: {
    ...common,
    ...child,
    ...text,
    ...box,
    ...tag(["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "strong", "em", "small", "label", "a", "button", "li"]),
    content: z.string(),
  },
  image: {
    ...common,
    ...child,
    src: z.string(),
    alt: z.string(),
    ...box,
    "style.object-fit": z.enum(["cover", "contain", "fill"]),
  },
  instance: {
    ...common,
    ...child,
    component: Id,
  },
};

/** 인스턴스 override(`node.<경로>.<키>`)로 바꿀 수 있는 키. 이 밖에는 원본 값이 토큰 바인딩인 키를 다른 토큰으로 바꿀 수 있다. */
export const OVERRIDE_KEYS: Record<string, z.ZodType> = { content: z.string(), src: z.string(), alt: z.string(), hidden: z.boolean() };

export const STATES = ["hover", "pressed", "focus", "disabled"] as const;
export type Condition = "bp" | "cq" | "var" | "state";

/** 기본키가 그 종류의 조건을 받을 수 있는지. */
export function condAllowed(key: string, cond: Condition) {
  if (key.startsWith("style.")) return true;
  if (cond === "state") return false;
  if (key === "src") return cond === "bp";
  return /^(layout|size|grid)\./.test(key) || ["x", "y", "w", "h", "hidden"].includes(key);
}

export const PARENTS: Record<ObjType, (ObjType | null)[]> = {
  breakpoint: ["frame"],
  componentProp: ["component"],
  modifier: [null],
  token: [null],
  frame: [null],
  component: [null],
  section: ["frame"],
  container: ["frame", "component", "section", "container"],
  text: ["frame", "component", "section", "container"],
  image: ["frame", "component", "section", "container"],
  instance: ["frame", "component", "section", "container"],
};

export const Placement = z.union([
  z.enum(["first", "last"]),
  z.strictObject({ before: Id }),
  z.strictObject({ after: Id }),
]);

const Props = z.record(z.string(), z.unknown());

export const Op = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("create"),
    id: Id,
    type: z.enum(OBJ_TYPES),
    parent: Id.nullable(),
    placement: Placement.optional(),
    props: Props.optional(),
  }),
  z.strictObject({ op: z.literal("set"), id: Id, props: Props }),
  z.strictObject({ op: z.literal("move"), id: Id, parent: Id.nullable(), placement: Placement }),
  z.strictObject({ op: z.literal("delete"), id: Id }),
  z.strictObject({ op: z.literal("detach"), id: Id }),
]);

export const Tx = z.strictObject({
  txId: z.string().min(1),
  actor: z.string().regex(/^(user|ai):.+$/),
  ops: z.array(Op).min(1),
});

export type Placement = z.infer<typeof Placement>;
export type Op = z.infer<typeof Op>;
export type Tx = z.infer<typeof Tx>;
