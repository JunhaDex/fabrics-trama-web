import { z } from "zod";

export const Id = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);

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
  position: z.enum(["static", "absolute"]),
  x: num4,
  y: num4,
  w: num4.min(0),
  h: num4.min(0),
};

const tag = (tags: [string, ...string[]]) => ({ tag: z.enum(tags) });

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
