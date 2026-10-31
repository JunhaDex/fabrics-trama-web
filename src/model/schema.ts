import { z } from "zod";

// 계약: docs/architecture/trama-document-model.md. v0.2는 노드 5종의 base 키만 다룬다.

export const Id = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);

// 소수 넷째 자리까지만 허용한다(4절).
const num4 = z
  .number()
  .finite()
  .refine((n) => Math.round(n * 1e4) / 1e4 === n);

export const Dimension = z.strictObject({
  value: num4,
  unit: z.enum(["px", "rem"]),
});

const intMin1 = z.number().int().min(1);
const size = z.union([z.enum(["fill", "hug"]), Dimension]);

export const NODE_TYPES = ["frame", "section", "container", "text", "image"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const common = {
  name: z.string(),
  hidden: z.boolean(),
};

const layout = {
  "layout.mode": z.enum(["flex-row", "flex-column", "grid"]),
  "layout.gap": Dimension,
  "layout.rowGap": Dimension,
  "layout.justify": z.enum(["start", "center", "end", "space-between", "space-around", "space-evenly"]),
  "layout.align": z.enum(["start", "center", "end", "stretch", "baseline"]),
  "layout.wrap": z.boolean(),
  "layout.columns": intMin1,
  "layout.clip": z.boolean(),
};

const child = {
  "size.width": size,
  "size.height": size,
  "size.minWidth": Dimension,
  "size.maxWidth": Dimension,
  "size.minHeight": Dimension,
  "size.maxHeight": Dimension,
  "grid.colStart": intMin1,
  "grid.colSpan": intMin1,
  "grid.rowStart": intMin1,
  "grid.rowSpan": intMin1,
  // absolute로 바꾸는 순간 편집기가 측정한 rect(부모 좌상단 기준 px)를 저장한다.
  position: z.enum(["static", "absolute"]),
  x: num4,
  y: num4,
  w: num4.min(0),
  h: num4.min(0),
};

const tag = (tags: [string, ...string[]]) => ({ tag: z.enum(tags) });

// 종류별 허용 키와 값 스키마. parent·order·type은 연산이 직접 다룬다.
export const KEYS: Record<NodeType, Record<string, z.ZodType>> = {
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
  },
  section: {
    ...common,
    ...layout,
    ...child,
    ...tag(["section", "header", "footer", "nav", "main", "aside", "article"]),
  },
  container: {
    ...common,
    ...layout,
    ...child,
    ...tag(["div", "ul", "ol", "li", "figure", "a", "button", "form", "label"]),
  },
  text: {
    ...common,
    ...child,
    ...tag(["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "strong", "em", "small", "label", "a", "button", "li"]),
    content: z.string(),
  },
  image: {
    ...common,
    ...child,
    src: z.string(),
    alt: z.string(),
    "style.object-fit": z.enum(["cover", "contain", "fill"]),
  },
};

// 3절 부모 규칙. null은 보드(루트)다.
export const PARENTS: Record<NodeType, (NodeType | null)[]> = {
  frame: [null],
  section: ["frame"],
  container: ["frame", "section", "container"],
  text: ["frame", "section", "container"],
  image: ["frame", "section", "container"],
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
    type: z.enum(NODE_TYPES),
    parent: Id.nullable(),
    placement: Placement,
    props: Props.optional(),
  }),
  z.strictObject({ op: z.literal("set"), id: Id, props: Props }),
  z.strictObject({ op: z.literal("move"), id: Id, parent: Id.nullable(), placement: Placement }),
  z.strictObject({ op: z.literal("delete"), id: Id }),
]);

export const Tx = z.strictObject({
  txId: z.string().min(1),
  actor: z.string().regex(/^(user|ai):.+$/),
  ops: z.array(Op).min(1),
});

export type Placement = z.infer<typeof Placement>;
export type Op = z.infer<typeof Op>;
export type Tx = z.infer<typeof Tx>;
