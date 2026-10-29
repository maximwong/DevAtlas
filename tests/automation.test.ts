import { it, expect } from "vitest";
import { demo, executeTool, listTools } from "../src/automation";

it("通过工具创建导图、节点、项目和任务并移动看板状态", () => {
  let w = demo();
  function call(tool: string, args: unknown) {
    const next = executeTool(w, tool, args); w = next.workspace; return next.result as { id: string };
  }
  const map = call("maps_create", { name: "接口测试" });
  const root = call("nodes_create", { mapId: map.id, title: "根节点" });
  const child = call("nodes_create", { mapId: map.id, title: "子节点", parentId: root.id });
  const project = call("projects_create", { name: "工具项目", nodeIds: [root.id] });
  const sprint = call("sprints_create", { name: "Sprint 1", start: "2026-10-29", end: "2026-11-10" });
  const task = call("tasks_create", { title: "工具任务", nodeIds: [child.id], projectId: project.id, sprintId: sprint.id });
  call("tasks_move", { id: task.id, status: "Done" });
  expect(w.tasks.find((t) => t.id === task.id)).toMatchObject({ status: "Done", nodeIds: [child.id] });
  expect(w.edges.some((e) => e.source === root.id && e.target === child.id)).toBe(true);
  expect(executeTool(w, "tasks_list", { nodeId: child.id, status: "Done" }).result).toHaveLength(1);
  expect(listTools()).toHaveLength(26);
});

it("拒绝未知参数、无效引用、无效 Sprint 日期、跨图连接和不明确的删除", () => {
  const w = demo();
  expect(() => executeTool(w, "maps_create", { name: "x", unknown: true })).toThrow();
  expect(() => executeTool(w, "tasks_create", { title: "x", nodeIds: ["missing"] })).toThrow();
  expect(() => executeTool(w, "nodes_update", { id: "n0", patch: { mapId: "x" } })).toThrow();
  expect(() => executeTool(w, "nodes_delete", { ids: ["n0"] })).toThrow();
  expect(() => executeTool(w, "maps_delete", { id: "main", confirm: true })).toThrow("最后一张");
  expect(() => executeTool(w, "sprints_create", { name: "x", start: "2026-02-30", end: "2026-03-05" })).toThrow();
  expect(() => executeTool(w, "tasks_move", { id: w.tasks[0].id, status: "Done", beforeId: w.tasks[1].id })).toThrow();
});

it("工具批量复制与移动保持内部连线语义，删除后清理引用", () => {
  let w = demo();
  const m = executeTool(w, "maps_create", { name: "目标" }); w = m.workspace;
  const mapId = (m.result as { id: string }).id;
  const copied = executeTool(w, "nodes_copy", { ids: ["n5", "n10"], targetMapId: mapId, position: { x: 0, y: 0 } });
  expect((copied.result as { ids: string[] }).ids).not.toContain("n5");
  w = executeTool(copied.workspace, "nodes_move", { ids: ["n5", "n10"], targetMapId: mapId, position: { x: 300, y: 0 } }).workspace;
  expect(w.tasks[0].nodeIds).toContain("n5");
  w = executeTool(w, "nodes_delete", { ids: ["n5", "n10"], confirm: true }).workspace;
  expect(w.tasks[0].nodeIds).toHaveLength(0);
  w = executeTool(w, "maps_delete", { id: mapId, confirm: true }).workspace;
  expect(w.maps).toHaveLength(1);
});
