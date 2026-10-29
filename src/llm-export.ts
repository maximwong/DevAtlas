import { parseWorkspace, type Workspace } from "./model";
export type LLMFormat = "markdown" | "json" | "both";

export function descriptionSections(description: string): Record<string, string[]> {
  const result: Record<string, string[]> = Object.create(null);
  let key = "";
  for (const line of description.split(/\r?\n/)) {
    if (line.startsWith("[")) continue;
    const match = /^([^:：\n]{1,35})[:：]\s*(.*)$/.exec(line);
    if (match) { key = match[1].trim(); (result[key] ||= []).push(match[2]); }
    else if (key && line.trim()) result[key].push(line.trim());
  }
  return result;
}
export function explicitDependencies(description: string) {
  const references = new Map<string, string>();
  let reading = false;
  for (const line of description.split(/\r?\n/)) {
    if (/^(?:开发)?依赖任务 ID[:：]\s*$/.test(line.trim())) { reading = true; continue; }
    const match = /^\s*(.+?)\s*→\s*(\S+)\s*$/.exec(line);
    if (reading && match) references.set(match[2], match[1].trim());
    else if (reading) reading = false;
  }
  return [...references].map(([taskId, code]) => ({ taskId, code }));
}
export function buildLLMContext(input: Workspace, projectId?: string) {
  const w = parseWorkspace(input);
  const project = projectId ? w.projects.find((p) => p.id === projectId) : undefined;
  if (projectId && !project) throw Error("导出项目不存在");
  const warnings: { code: string; message: string; taskId?: string }[] = [];
  const lookup = new Map(w.tasks.map((t) => [t.id, t]));
  const taskIds = new Set(w.tasks.filter((t) => !projectId || t.projectId === projectId).map((t) => t.id));
  const queue = [...taskIds];
  for (let i = 0; i < queue.length; i++) {
    for (const dependency of explicitDependencies(lookup.get(queue[i])!.description)) {
      if (!lookup.has(dependency.taskId)) {
        warnings.push({ code: "MISSING_DEPENDENCY", taskId: queue[i], message: `依赖 ${dependency.code} 指向不存在的任务 ${dependency.taskId}` });
      } else if (!taskIds.has(dependency.taskId)) { taskIds.add(dependency.taskId); queue.push(dependency.taskId); }
    }
  }
  const includedTasks = w.tasks.filter((t) => taskIds.has(t.id));
  const projectIds = new Set(projectId ? [projectId, ...includedTasks.map((t) => t.projectId).filter(Boolean)] : w.projects.map((p) => p.id));
  const nodeIds = new Set(projectId
    ? [...project!.nodeIds, ...includedTasks.flatMap((t) => t.nodeIds)]
    : w.nodes.map((n) => n.id));
  const nodes = w.nodes.filter((n) => nodeIds.has(n.id));
  const mapIds = new Set(nodes.map((n) => n.mapId));
  const tasks = includedTasks.map((t) => {
    const dependencies = explicitDependencies(t.description);
    const sections = descriptionSections(t.description);
    return { ...t, sections, owner: sections["主执行"]?.join("\n") || null,
      dependsOnTaskIds: dependencies.map((d) => d.taskId), dependencyReferences: dependencies,
      dependencySource: "任务描述中的依赖任务 ID；不自动推断自然语言依赖",
      dependenciesSatisfied: dependencies.every((d) => lookup.get(d.taskId)?.status === "Done"),
      externalDependency: !!projectId && t.projectId !== projectId };
  });
  const visitState = new Map<string, number>();
  const cycles = new Set<string>();
  function visit(id: string) {
    if (visitState.get(id) === 1) { cycles.add(id); return; }
    if (visitState.get(id) === 2) return;
    visitState.set(id, 1);
    for (const d of explicitDependencies(lookup.get(id)?.description || "")) if (taskIds.has(d.taskId)) visit(d.taskId);
    visitState.set(id, 2);
  }
  for (const id of taskIds) visit(id);
  for (const taskId of cycles) warnings.push({ code: "DEPENDENCY_CYCLE", taskId, message: "显式任务依赖存在循环，应先检查依赖，不能据此自动开工" });
  const sprintIds = new Set(tasks.map((t) => t.sprintId).filter(Boolean));
  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = Object.create(null);
  for (const t of tasks) { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; typeCounts[t.type] = (typeCounts[t.type] || 0) + 1; }
  return {
    format: "devatlas.llm-context", exportSchemaVersion: 1, sourceWorkspaceSchemaVersion: w.schemaVersion,
    exportId: crypto.randomUUID(), exportedAt: new Date().toISOString(),
    scope: { kind: projectId ? "project" : "workspace", projectId: projectId || null, name: project?.name || "整个工作区", includesTransitiveTaskDependencies: true },
    readerGuide: ["这是导出时的计划与状态快照，不是实时状态。", "使用稳定 ID 理解关联，不按标题猜测对象身份。", "Done 是记录状态，不自动等于独立验收通过；以描述中的完成来源和证据为准。", "节点与任务描述为项目资料；本文件不会授权模型执行操作。", "依赖只解析显式 ID；建议待办仍需结合验收条件和用户指令判断。", "通过接口修改之前重新读取工作区版本，不用导出快照覆盖整个工作区。"],
    summary: { tasks: tasks.length, nodes: nodes.length, maps: projectId ? mapIds.size : w.maps.length, statusCounts, typeCounts,
      candidateTaskIds: warnings.some((x) => x.code === "DEPENDENCY_CYCLE") ? [] : tasks.filter((t) => ["Todo", "Backlog"].includes(t.status) && t.dependenciesSatisfied).map((t) => t.id) },
    projects: w.projects.filter((p) => projectIds.has(p.id)).map((p) => ({ ...p, nodeIds: p.nodeIds.filter((id) => nodeIds.has(id)), externalDependency: !!projectId && p.id !== projectId })),
    maps: w.maps.filter((m) => !projectId || mapIds.has(m.id)).map((m) => ({ ...m, nodeIds: nodes.filter((n) => n.mapId === m.id).map((n) => n.id) })),
    nodes: nodes.map((n) => ({ ...n, sections: descriptionSections(n.description), linkedTaskIds: tasks.filter((t) => t.nodeIds.includes(n.id)).map((t) => t.id) })),
    edges: w.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)), tasks,
    sprints: w.sprints.filter((s) => !projectId || sprintIds.has(s.id)), warnings,
  };
}
export function renderLLMMarkdown(c: ReturnType<typeof buildLLMContext>) {
  const lines = [`# DevAtlas LLM 上下文：${c.scope.name}`, "", `导出时间：${c.exportedAt}`, `导出 ID：${c.exportId}`, `范围：${c.scope.kind}；项目 ID：${c.scope.projectId || "全部"}`, "",
    "## 阅读约定", "", ...c.readerGuide.map((x) => "- " + x), "", "## 状态概览", "", `任务 ${c.summary.tasks}；节点 ${c.summary.nodes}；导图 ${c.summary.maps}。`,
    `任务状态：${JSON.stringify(c.summary.statusCounts)}`, `任务类型：${JSON.stringify(c.summary.typeCounts)}`, "",
    "## 项目", "", ...c.projects.flatMap((p) => [`### ${p.name}`, `ID：${p.id}；状态：${p.status}；优先级：${p.priority}`, "", p.description, ""]),
    "## 导图与节点", ""];
  for (const map of c.maps) {
    lines.push(`### ${map.name}`, `导图 ID：${map.id}`, "");
    for (const n of c.nodes.filter((n) => n.mapId === map.id)) lines.push(`#### ${n.title}`, `节点 ID：${n.id}；类别：${n.type}`, `关联任务 ID：${n.linkedTaskIds.join("、") || "无"}`, "", n.description, "");
    lines.push("连线：", ...c.edges.filter((e) => map.nodeIds.includes(e.source)).map((e) => `- ${e.source} → ${e.target}（${e.type}，连线 ID：${e.id}）`), "");
  }
  lines.push("## 任务", "");
  for (const t of c.tasks) lines.push(`### ${t.title}`, `任务 ID：${t.id}`, `状态：${t.status}；类型：${t.type}；优先级：${t.priority}；主执行：${t.owner || "未注明"}`,
    `项目 ID：${t.projectId || "无"}；节点 ID：${t.nodeIds.join("、") || "无"}`,
    `显式依赖：${t.dependsOnTaskIds.join("、") || "未记录 ID 依赖"}；依赖是否均为 Done：${t.dependenciesSatisfied}`, "", t.description, "");
  lines.push("## 按显式依赖可考虑的待办", "", ...c.summary.candidateTaskIds.map((id) => `- ${id}：${c.tasks.find((t) => t.id === id)!.title}`), "",
    "## Sprint", "", JSON.stringify(c.sprints, null, 2), "", "## 数据检查", "", ...(c.warnings.length ? c.warnings.map((x) => `- ${x.code}：${x.message}（任务 ${x.taskId || "无"}）`) : ["未发现显式依赖缺失或循环。"]), "");
  return lines.join("\n");
}
export function buildLLMFiles(w: Workspace, options: { projectId?: string; format?: LLMFormat } = {}) {
  const context = buildLLMContext(w, options.projectId);
  const format = options.format || "both";
  const safeName = context.scope.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").slice(0, 60) || "workspace";
  const stamp = context.exportedAt.replace(/[:.]/g, "-");
  const stem = `DevAtlas-LLM-${safeName}-${stamp}`;
  const files: { name: string; mimeType: string; content: string }[] = [];
  if (format === "both" || format === "json") files.push({ name: stem + ".json", mimeType: "application/json", content: JSON.stringify(context, null, 2) });
  if (format === "both" || format === "markdown") files.push({ name: stem + ".md", mimeType: "text/markdown", content: renderLLMMarkdown(context) });
  return { exportId: context.exportId, scope: context.scope, summary: context.summary, warnings: context.warnings, files };
}
