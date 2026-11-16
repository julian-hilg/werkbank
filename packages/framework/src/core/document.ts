import { z } from "zod";

/**
 * The workspace document: everything that defines what is on screen.
 * It is plain JSON, validated before use, and never contains data payloads.
 */

export const LayoutTabSchema = z.object({
  /** Equals the instance id of the panel shown in this tab. */
  id: z.string().min(1),
  title: z.string().optional(),
});
export type LayoutTab = z.infer<typeof LayoutTabSchema>;

const size = z.union([z.number(), z.string()]).optional();

export type LayoutTabset = {
  type: "tabset";
  id: string;
  size?: number | string | undefined;
  selectedId?: string | undefined;
  tabs: LayoutTab[];
};
export type LayoutSplit = {
  type: "split";
  id: string;
  orientation: "horizontal" | "vertical";
  size?: number | string | undefined;
  children: LayoutNode[];
};
export type LayoutNode = LayoutTabset | LayoutSplit;

export const LayoutTabsetSchema: z.ZodType<LayoutTabset> = z.object({
  type: z.literal("tabset"),
  id: z.string().min(1),
  size,
  selectedId: z.string().optional(),
  tabs: z.array(LayoutTabSchema),
});

export const LayoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    LayoutTabsetSchema,
    z.object({
      type: z.literal("split"),
      id: z.string().min(1),
      orientation: z.enum(["horizontal", "vertical"]),
      size,
      children: z.array(LayoutNodeSchema),
    }),
  ]),
);

export const FloatingSchema = z.object({
  type: z.literal("tabset"),
  id: z.string().min(1),
  selectedId: z.string().optional(),
  tabs: z.array(LayoutTabSchema),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type LayoutFloating = z.infer<typeof FloatingSchema>;

export const LayoutSchema = z.object({
  root: LayoutNodeSchema,
  floating: z.array(FloatingSchema).optional(),
  maximizedTabsetId: z.string().optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const InstanceSchema = z.object({
  id: z.string().min(1),
  toolId: z.string().min(1),
  /** Version of the tool's state schema this state was written with. */
  version: z.number().int(),
  state: z.unknown(),
  /** Link group this panel follows, or null when independent. */
  link: z.string().nullable(),
  /** Topic values the panel holds itself while independent. */
  local: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
});
export type Instance = z.infer<typeof InstanceSchema>;

export const ShellSchema = z.object({
  sideView: z.string().nullable(),
  sideWidth: z.number().min(120).max(800),
  theme: z.string(),
  density: z.enum(["compact", "comfortable"]),
  zen: z.boolean(),
});
export type ShellState = z.infer<typeof ShellSchema>;

export const DOC_SCHEMA = 1 as const;

export const WorkspaceDocSchema = z.object({
  schema: z.literal(DOC_SCHEMA),
  appId: z.string(),
  name: z.string(),
  layout: LayoutSchema,
  instances: z.record(z.string(), InstanceSchema),
  /** Link group id -> topic -> last published value. */
  links: z.record(z.string(), z.record(z.string(), z.unknown())),
  shell: ShellSchema,
});
export type WorkspaceDoc = z.infer<typeof WorkspaceDocSchema>;

/** Hard limits so a stored document cannot grow without bound. */
export const LIMITS = { instances: 48, bytes: 512_000 } as const;

export const LINK_GROUPS = ["1", "2", "3", "4"] as const;

export const emptyLayout = (): Layout => ({
  root: { type: "tabset", id: "root", tabs: [] },
});

export const defaultShell = (theme = "xp"): ShellState => ({
  sideView: "tools",
  sideWidth: 200,
  theme,
  density: "compact",
  zen: false,
});
