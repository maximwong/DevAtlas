import { z } from "zod";
import { buildLLMFiles } from "./llm-export";
import { demo, parseWorkspace, workspaceSchema, nodeSchema, appendMapNode, removeNodes, copyMapNodes, pasteMapNodes, newTask, moveTask, uid, statuses, relations, type Workspace } from "./model";
export { demo, parseWorkspace };
const id = z.string().min(1);
const name = z.string().trim().min(1).max(500);
const position = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const ids = z.array(id).min(1).max(1000).refine((a) => new Set(a).size === a.length, "重复 ID");
const task = workspaceSchema.shape.tasks.element;
const project = workspaceSchema.shape.projects.element;
const sprint = workspaceSchema.shape.sprints.element;
const tools = {
  workspace_get: { description: "读取完整工作区及稳定 ID", schema: z.object({}).strict(), write: false },
  workspace_export_llm: { description: "生成便于 LLM 读取的 Markdown/JSON 文件内容，支持按项目及传递依赖导出；只读，不直接写磁盘", schema: z.object({ projectId: id.optional(), format: z.enum(["markdown", "json", "both"]).optional() }).strict(), write: false },
  maps_list: { description: "列出全部导图", schema: z.object({}).strict(), write: false },
  maps_create: { description: "新建空白导图", schema: z.object({ name }).strict(), write: true },
  maps_update: { description: "按 ID 重命名导图", schema: z.object({ id, name }).strict(), write: true },
  maps_delete: { description: "删除导图及其节点；任务、项目本身保留。不能删除最后一张导图", schema: z.object({ id, confirm: z.literal(true) }).strict(), write: true },
  nodes_list: { description: "按导图或关键词列出节点", schema: z.object({ mapId: id.optional(), query: z.string().optional() }).strict(), write: false },
  nodes_create: { description: "在导图中新建节点；可指定父节点自动连线", schema: z.object({ mapId: id, title: name, parentId: id.optional(), relation: z.enum(relations).optional(), position: position.optional(), description: z.string().optional(), color: z.string().optional(), type: nodeSchema.shape.type.optional() }).strict(), write: true },
  nodes_update: { description: "按 ID 编辑节点属性，跨图移动请用 nodes_move", schema: z.object({ id, patch: nodeSchema.omit({ id: true, mapId: true }).partial().strict() }).strict(), write: true },
  nodes_delete: { description: "批量删除节点、相关连线并清理引用，任务和项目保留", schema: z.object({ ids, confirm: z.literal(true) }).strict(), write: true },
  nodes_copy: { description: "复制节点到导图，生成新 ID，保留内部连线，不复制任务绑定", schema: z.object({ ids, targetMapId: id, position }).strict(), write: true },
  nodes_move: { description: "移动节点到导图，保留 ID 和任务绑定，跨图边界连线会断开", schema: z.object({ ids, targetMapId: id, position }).strict(), write: true },
  edges_list: { description: "列出导图连线", schema: z.object({ mapId: id.optional() }).strict(), write: false },
  edges_create: { description: "连接同一导图的两个节点；相同关系重复调用返回已有连线", schema: z.object({ source: id, target: id, type: z.enum(relations) }).strict(), write: true },
  edges_delete: { description: "批量删除连线", schema: z.object({ ids, confirm: z.literal(true) }).strict(), write: true },
  tasks_list: { description: "按项目、状态、节点或关键词查询任务", schema: z.object({ projectId: id.optional(), status: z.enum(statuses).optional(), nodeId: id.optional(), query: z.string().optional() }).strict(), write: false },
  tasks_create: { description: "创建任务，可指定项目、节点、Sprint 和看板状态", schema: task.omit({ id: true, createdAt: true, updatedAt: true }).partial().extend({ title: name }).strict(), write: true },
  tasks_update: { description: "编辑任务字段、绑定或状态", schema: z.object({ id, patch: task.omit({ id: true, createdAt: true, updatedAt: true }).partial().strict() }).strict(), write: true },
  tasks_move: { description: "把任务移到看板分区，可指定排在哪个任务之前", schema: z.object({ id, status: z.enum(statuses), beforeId: id.optional() }).strict(), write: true },
  tasks_delete: { description: "删除任务，保留技术节点", schema: z.object({ ids, confirm: z.literal(true) }).strict(), write: true },
  projects_list: { description: "列出项目", schema: z.object({}).strict(), write: false },
  projects_create: { description: "创建项目", schema: project.omit({ id: true, createdAt: true }).partial().extend({ name }).strict(), write: true },
  projects_update: { description: "编辑项目及其节点关联", schema: z.object({ id, patch: project.omit({ id: true, createdAt: true }).partial().strict() }).strict(), write: true },
  sprints_list: { description: "列出 Sprint", schema: z.object({}).strict(), write: false },
  sprints_create: { description: "创建 Sprint，日期使用 YYYY-MM-DD", schema: sprint.omit({ id: true }).strict(), write: true },
  sprints_update: { description: "编辑 Sprint", schema: z.object({ id, patch: sprint.omit({ id: true }).partial().strict() }).strict(), write: true },
} as const;
export function listTools() {
  return Object.entries(tools).map(([name, t]) => ({ name, description: t.description, mutates: t.write, inputSchema: z.toJSONSchema(t.schema) }));
}
export function isWriteTool(tool: string) {
  if (!Object.hasOwn(tools, tool)) throw Error("未知操作: " + tool);
  return tools[tool as keyof typeof tools].write;
}
function requireIds(items: { id: string }[], selected: string[]) {
  if (selected.some((id) => !items.some((x) => x.id === id))) throw Error("指定的 ID 不存在");
}
function update<T extends { id: string }>(items: T[], id: string, patch: Partial<T>): T[] {
  requireIds(items, [id]); return items.map((x) => x.id === id ? { ...x, ...patch } : x);
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value; }
export function executeTool(workspace: Workspace, tool: string, input: unknown): { workspace: Workspace; result: unknown } {
  let w = parseWorkspace(workspace);
  let result: unknown;
  switch (tool) {
    case "workspace_get": tools.workspace_get.schema.parse(input); result = w; break;
    case "workspace_export_llm": { const a = tools.workspace_export_llm.schema.parse(input); result = buildLLMFiles(w, a); break; }
    case "maps_list": tools.maps_list.schema.parse(input); result = w.maps; break;
    case "maps_create": { const a = tools.maps_create.schema.parse(input); const m = { id: uid(), name: a.name }; w = { ...w, maps: [...w.maps, m] }; result = m; break; }
    case "maps_update": { const a = tools.maps_update.schema.parse(input); w = { ...w, maps: update(w.maps, a.id, { name: a.name }) }; result = w.maps.find((x) => x.id === a.id); break; }
    case "maps_delete": { const a = tools.maps_delete.schema.parse(input); requireIds(w.maps, [a.id]); if (w.maps.length === 1) throw Error("不能删除最后一张导图"); w = removeNodes(w, w.nodes.filter((n) => n.mapId === a.id).map((n) => n.id)); w = { ...w, maps: w.maps.filter((m) => m.id !== a.id) }; result = { deleted: a.id }; break; }
    case "nodes_list": { const a = tools.nodes_list.schema.parse(input); result = w.nodes.filter((n) => (!a.mapId || n.mapId === a.mapId) && (!a.query || n.title.toLowerCase().includes(a.query.toLowerCase()))); break; }
    case "nodes_create": { const a = tools.nodes_create.schema.parse(input); w = appendMapNode(w, a.position || { x: 0, y: 0 }, a.parentId, a.relation, a.mapId); const created = w.nodes.at(-1)!; const { mapId: _m, parentId: _p, relation: _r, position: _pos, ...patch } = a; w = { ...w, nodes: update(w.nodes, created.id, patch) }; result = w.nodes.at(-1); break; }
    case "nodes_update": { const a = tools.nodes_update.schema.parse(input); w = { ...w, nodes: update(w.nodes, a.id, a.patch) }; result = w.nodes.find((n) => n.id === a.id); break; }
    case "nodes_delete": { const a = tools.nodes_delete.schema.parse(input); requireIds(w.nodes, a.ids); w = removeNodes(w, a.ids); result = { deleted: a.ids }; break; }
    case "nodes_copy": case "nodes_move": { const a = tools[tool].schema.parse(input); requireIds(w.nodes, a.ids); const maps = new Set(w.nodes.filter((n) => a.ids.includes(n.id)).map((n) => n.mapId)); if (maps.size !== 1) throw Error("一次只能复制或移动同一导图的节点"); const moved = pasteMapNodes(w, copyMapNodes(w, a.ids, tool === "nodes_copy" ? "copy" : "cut"), a.targetMapId, a.position); w = moved.workspace; result = { ids: moved.ids }; break; }
    case "edges_list": { const a = tools.edges_list.schema.parse(input); const nodes = new Set(w.nodes.filter((n) => !a.mapId || n.mapId === a.mapId).map((n) => n.id)); result = w.edges.filter((e) => nodes.has(e.source)); break; }
    case "edges_create": { const a = tools.edges_create.schema.parse(input); if (a.source === a.target) throw Error("不能连接节点自身"); const edge = w.edges.find((e) => e.source === a.source && e.target === a.target && e.type === a.type) || { id: uid(), ...a }; if (!w.edges.some((e) => e.id === edge.id)) w = { ...w, edges: [...w.edges, edge] }; result = edge; break; }
    case "edges_delete": { const a = tools.edges_delete.schema.parse(input); requireIds(w.edges, a.ids); w = { ...w, edges: w.edges.filter((e) => !a.ids.includes(e.id)) }; result = { deleted: a.ids }; break; }
    case "tasks_list": { const a = tools.tasks_list.schema.parse(input); result = w.tasks.filter((t) => (!a.projectId || t.projectId === a.projectId) && (!a.status || t.status === a.status) && (!a.nodeId || t.nodeIds.includes(a.nodeId)) && (!a.query || t.title.toLowerCase().includes(a.query.toLowerCase()))); break; }
    case "tasks_create": { const a = tools.tasks_create.schema.parse(input); const created = { ...newTask(a.title), ...a }; w = { ...w, tasks: [...w.tasks, created] }; result = created; break; }
    case "tasks_update": { const a = tools.tasks_update.schema.parse(input); w = { ...w, tasks: update(w.tasks, a.id, { ...a.patch, updatedAt: new Date().toISOString() }) }; result = w.tasks.find((t) => t.id === a.id); break; }
    case "tasks_move": { const a = tools.tasks_move.schema.parse(input); requireIds(w.tasks, [a.id]); if (a.beforeId) { requireIds(w.tasks, [a.beforeId]); if (a.beforeId === a.id || w.tasks.find((t) => t.id === a.beforeId)?.status !== a.status) throw Error("排序目标必须是目标分区中的其他任务"); } w = moveTask(w, a.id, a.status, a.beforeId); result = w.tasks.find((t) => t.id === a.id); break; }
    case "tasks_delete": { const a = tools.tasks_delete.schema.parse(input); requireIds(w.tasks, a.ids); w = { ...w, tasks: w.tasks.filter((t) => !a.ids.includes(t.id)) }; result = { deleted: a.ids }; break; }
    case "projects_list": tools.projects_list.schema.parse(input); result = w.projects; break;
    case "projects_create": { const a = tools.projects_create.schema.parse(input); const created = { id: uid(), description: "", status: "进行中", priority: "中", createdAt: new Date().toISOString(), due: "", url: "", nodeIds: [], ...a }; w = { ...w, projects: [...w.projects, created] }; result = created; break; }
    case "projects_update": { const a = tools.projects_update.schema.parse(input); w = { ...w, projects: update(w.projects, a.id, a.patch) }; result = w.projects.find((p) => p.id === a.id); break; }
    case "sprints_list": tools.sprints_list.schema.parse(input); result = w.sprints; break;
    case "sprints_create": { const a = tools.sprints_create.schema.parse(input); const created = { id: uid(), ...a }; w = { ...w, sprints: [...w.sprints, created] }; result = created; break; }
    case "sprints_update": { const a = tools.sprints_update.schema.parse(input); w = { ...w, sprints: update(w.sprints, a.id, a.patch) }; result = w.sprints.find((s) => s.id === a.id); break; }
    default: throw Error("未知操作: " + tool);
  }
  if (tool.startsWith("sprints_") && isWriteTool(tool)) {
    const s = result as Workspace["sprints"][number];
    if (!validDate(s.start) || !validDate(s.end) || s.end < s.start) throw Error("Sprint 日期无效");
  }
  return { workspace: parseWorkspace(w), result };
}
