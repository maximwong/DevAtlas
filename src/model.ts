import { z } from "zod";
export const statuses = [
  "Backlog",
  "Todo",
  "In Progress",
  "Testing",
  "Done",
] as const;
export const nodeTypes = [
  "技术 / 知识",
  "项目",
  "学习目标",
  "开发任务",
  "里程碑",
] as const;
export const relations = [
  "前置依赖",
  "技术支撑",
  "项目包含",
  "任务关联",
] as const;
const id = z.string().min(1);
const date = z.string();
export const nodeSchema = z.object({
  id,
  mapId: id,
  title: z.string().min(1),
  description: z.string(),
  type: z.enum(nodeTypes),
  color: z.string(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
});
const taskSchema = z.object({
  id,
  title: z.string().min(1),
  description: z.string(),
  type: z.string(),
  priority: z.enum(["高", "中", "低"]),
  status: z.enum(statuses),
  projectId: z.string(),
  nodeIds: z.array(id),
  sprintId: z.string(),
  due: date,
  estimate: z.number().nonnegative(),
  color: z.string(),
  createdAt: date,
  updatedAt: date,
});
export const workspaceSchema = z.object({
  schemaVersion: z.literal(2),
  maps: z.array(z.object({ id, name: z.string().trim().min(1) })).min(1),
  nodes: z.array(nodeSchema),
  edges: z.array(
    z.object({ id, source: id, target: id, type: z.enum(relations) }),
  ),
  tasks: z.array(taskSchema),
  projects: z.array(
    z.object({
      id,
      name: z.string().min(1),
      description: z.string(),
      status: z.string(),
      priority: z.string(),
      createdAt: date,
      due: date,
      url: z.string(),
      nodeIds: z.array(id),
    }),
  ),
  sprints: z.array(
    z.object({ id, name: z.string().min(1), start: date, end: date }),
  ),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type AtlasNode = z.infer<typeof nodeSchema>;
export type Task = z.infer<typeof taskSchema>;
export const uid = () => crypto.randomUUID();
export function appendMapNode(
  w: Workspace,
  position: AtlasNode["position"],
  parentId?: string,
  relation: (typeof relations)[number] = "前置依赖",
  mapId = w.maps[0].id,
): Workspace {
  const parent = parentId ? w.nodes.find((n) => n.id === parentId) : undefined;
  if (parentId && !parent) throw Error("父节点不存在");
  if (!w.maps.some((m) => m.id === mapId) || (parent && parent.mapId !== mapId))
    throw Error("导图引用无效");
  const point = parent
    ? { x: parent.position.x + 280, y: parent.position.y }
    : { ...position };
  while (w.nodes.some((n) => n.mapId === mapId &&
    Math.abs(n.position.x - point.x) < 240 &&
    Math.abs(n.position.y - point.y) < 110,
  )) point.y += 125;
  const node: AtlasNode = {
    id: uid(),
    mapId,
    title: parent ? "新子节点" : "新节点",
    description: "",
    type: "技术 / 知识",
    color: parent?.color || "#54b8ac",
    position: point,
  };
  return {
    ...w,
    nodes: [...w.nodes, node],
    edges: parent
      ? [...w.edges, { id: uid(), source: parent.id, target: node.id, type: relation }]
      : w.edges,
  };
}
export function parseWorkspace(value: unknown): Workspace {
  let input = value;
  if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === 1) {
    const legacy = workspaceSchema.omit({ maps: true }).extend({
      schemaVersion: z.literal(1),
      nodes: z.array(nodeSchema.omit({ mapId: true })),
    }).parse(value);
    input = { ...legacy, schemaVersion: 2, maps: [{ id: "main", name: "原有思维导图" }],
      nodes: legacy.nodes.map((n) => ({ ...n, mapId: "main" })) };
  }
  const w = workspaceSchema.parse(input);
  for (const key of [
    "nodes",
    "maps",
    "edges",
    "tasks",
    "projects",
    "sprints",
  ] as const) {
    if (new Set(w[key].map((x) => x.id)).size !== w[key].length)
      throw Error("重复 ID");
  }
  const ns = new Set(w.nodes.map((n) => n.id));
  const maps = new Map(w.nodes.map((n) => [n.id, n.mapId]));
  if (w.nodes.some((n) => !w.maps.some((m) => m.id === n.mapId)) ||
      w.edges.some((e) => maps.get(e.source) !== maps.get(e.target)))
    throw Error("导图引用无效或存在跨图连线");
  if (
    w.edges.some((e) => !ns.has(e.source) || !ns.has(e.target)) ||
    w.tasks.some((t) => t.nodeIds.some((id) => !ns.has(id))) ||
    w.projects.some((p) => p.nodeIds.some((id) => !ns.has(id)))
  )
    throw Error("节点引用无效");
  if (
    w.tasks.some(
      (t) =>
        (t.projectId && !w.projects.some((p) => p.id === t.projectId)) ||
        (t.sprintId && !w.sprints.some((s) => s.id === t.sprintId)),
    )
  )
    throw Error("项目或 Sprint 引用无效");
  return w;
}
export const progress = (w: Workspace, id?: string) => {
  const tasks = id ? w.tasks.filter((t) => t.nodeIds.includes(id)) : w.tasks;
  const done = tasks.filter((t) => t.status === "Done").length;
  return {
    total: tasks.length,
    done,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
};
export function removeNode(w: Workspace, id: string): Workspace {
  return removeNodes(w, [id]);
}
export function removeNodes(w: Workspace, ids: string[]): Workspace {
  const removed = new Set(ids);
  return {
    ...w,
    nodes: w.nodes.filter((n) => !removed.has(n.id)),
    edges: w.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
    tasks: w.tasks.map((t) => ({
      ...t,
      nodeIds: t.nodeIds.filter((n) => !removed.has(n)),
    })),
    projects: w.projects.map((p) => ({
      ...p,
      nodeIds: p.nodeIds.filter((n) => !removed.has(n)),
    })),
  };
}
export type MapClipboard = {
  mode: "copy" | "cut";
  nodes: AtlasNode[];
  edges: Workspace["edges"];
};
export function copyMapNodes(w: Workspace, ids: string[], mode: MapClipboard["mode"]): MapClipboard {
  const selected = new Set(ids);
  return {
    mode,
    nodes: w.nodes.filter((n) => selected.has(n.id)).map((n) => ({ ...n, position: { ...n.position } })),
    edges: w.edges.filter((e) => selected.has(e.source) && selected.has(e.target)).map((e) => ({ ...e })),
  };
}
export function pasteMapNodes(w: Workspace, clip: MapClipboard, mapId: string, origin: AtlasNode["position"]): { workspace: Workspace; ids: string[] } {
  if (!clip.nodes.length || !w.maps.some((m) => m.id === mapId)) throw Error("没有可粘贴的节点或导图不存在");
  const moving = clip.mode === "cut";
  const source = moving ? clip.nodes.map((n) => w.nodes.find((x) => x.id === n.id)) : clip.nodes;
  if (source.some((n) => !n)) throw Error("剪切的节点已删除，请重新选择");
  const nodes = source as AtlasNode[];
  const selected = new Set(nodes.map((n) => n.id));
  const ids = new Map(nodes.map((n) => [n.id, moving ? n.id : uid()]));
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const pasted = nodes.map((n) => ({ ...n, id: ids.get(n.id)!, mapId,
    position: { x: origin.x + n.position.x - minX, y: origin.y + n.position.y - minY } }));
  const edges = moving
    ? w.edges.filter((e) => {
        const a = selected.has(e.source), b = selected.has(e.target);
        if (a === b) return true;
        const other = w.nodes.find((n) => n.id === (a ? e.target : e.source));
        return other?.mapId === mapId;
      })
    : [...w.edges, ...clip.edges.map((e) => ({ ...e, id: uid(), source: ids.get(e.source)!, target: ids.get(e.target)! }))];
  return { workspace: { ...w, nodes: [...w.nodes.filter((n) => !moving || !selected.has(n.id)), ...pasted], edges }, ids: pasted.map((n) => n.id) };
}
export function moveTask(
  w: Workspace,
  id: string,
  status: Task["status"],
  before?: string,
): Workspace {
  const task = w.tasks.find((t) => t.id === id);
  if (!task) return w;
  const tasks = w.tasks.filter((t) => t.id !== id);
  const index = before ? tasks.findIndex((t) => t.id === before) : -1;
  tasks.splice(index < 0 ? tasks.length : index, 0, {
    ...task,
    status,
    updatedAt: new Date().toISOString(),
  });
  return { ...w, tasks };
}
export function newTask(title: string, nodeIds: string[] = []): Task {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    description: "",
    type: "学习",
    priority: "中",
    status: "Todo",
    projectId: "",
    nodeIds,
    sprintId: "",
    due: "",
    estimate: 1,
    color: "#e5b94d",
    createdAt: now,
    updatedAt: now,
  };
}
export function demo(): Workspace {
  const names = [
    "Python",
    "Git / GitHub",
    "AI Coding",
    "LLM Agent",
    "OpenCV",
    "YOLO",
    "计算机视觉",
    "无人机",
    "ROS 2",
    "CAD 自动化",
    "车辆识别系统",
    "API 调用",
    "Tool Calling",
    "AI Agent",
    "视觉导航",
    "无人机系统",
  ];
  const nodes = names.map((title, i) => ({
    id: `n${i}`,
    mapId: "main",
    title,
    description: "双击名称编辑；在详情中关联任务。",
    type: (i === 10 || i === 15 ? "项目" : "技术 / 知识") as AtlasNode["type"],
    color: i === 10 ? "#9c87ef" : "#54b8ac",
    position: { x: (i % 4) * 265, y: Math.floor(i / 4) * 160 },
  }));
  const links = [
    [0, 4],
    [4, 5],
    [5, 10],
    [0, 11],
    [11, 12],
    [12, 13],
    [6, 14],
    [14, 15],
  ];
  const projects = ["车辆识别系统", "AI Agent 实验", "无人机视觉实验"].map(
    (name, i) => ({
      id: `p${i}`,
      name,
      description: "可编辑的示例项目",
      status: "进行中",
      priority: "高",
      createdAt: new Date().toISOString(),
      due: "",
      url: "",
      nodeIds: [`n${[10, 13, 15][i]}`],
    }),
  );
  const tasks = [
    "完成 YOLO 基础教程",
    "开发车辆检测 Demo",
    "优化实时推理性能",
  ].map((title, i) => ({
    ...newTask(title, ["n5", "n10"]),
    projectId: "p0",
    status: statuses[i + 1],
  }));
  return {
    schemaVersion: 2,
    maps: [{ id: "main", name: "技术版图" }],
    nodes,
    edges: links.map(([s, t], i) => ({
      id: `e${i}`,
      source: `n${s}`,
      target: `n${t}`,
      type: relations[i % 4],
    })),
    projects,
    tasks,
    sprints: [],
  };
}
