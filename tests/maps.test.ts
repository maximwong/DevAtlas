import { it, expect } from "vitest";
import { demo, parseWorkspace, copyMapNodes, pasteMapNodes, removeNodes, appendMapNode } from "../src/model";

it("旧版工作区迁移到一张原有导图，保留全部稳定 ID、任务和项目", () => {
  const current = demo();
  const { maps: _maps, ...old } = current;
  const legacy = { ...old, schemaVersion: 1, nodes: current.nodes.map(({ mapId: _map, ...n }) => n) };
  const migrated = parseWorkspace(JSON.parse(JSON.stringify(legacy)));
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.maps).toEqual([{ id: "main", name: "原有思维导图" }]);
  expect(migrated.nodes.map((n) => n.id)).toEqual(current.nodes.map((n) => n.id));
  expect(migrated.edges).toEqual(current.edges);
  expect(migrated.tasks).toEqual(current.tasks);
  expect(migrated.projects).toEqual(current.projects);
  const corrupt = { ...legacy, edges: [{ id: "broken", source: "missing", target: "n0", type: "前置依赖" }] };
  expect(() => parseWorkspace(corrupt)).toThrow();
});

it("跨图复制生成独立节点，只复制内部连线，重复粘贴 ID 不冲突", () => {
  const w = demo();
  w.maps.push({ id: "second", name: "第二张" });
  const clip = copyMapNodes(w, ["n0", "n4"], "copy");
  expect(clip.edges).toHaveLength(1);
  const first = pasteMapNodes(w, clip, "second", { x: 300, y: 400 });
  const second = pasteMapNodes(first.workspace, clip, "second", { x: 600, y: 700 });
  expect(new Set([...first.ids, ...second.ids]).size).toBe(4);
  expect(first.ids).not.toContain("n0");
  expect(first.workspace.nodes.filter((n) => n.mapId === "main")).toEqual(w.nodes);
  expect(first.workspace.edges.at(-1)).toMatchObject({ source: first.ids[0], target: first.ids[1] });
  expect(first.workspace.tasks).toEqual(w.tasks);
  expect(first.workspace.projects).toEqual(w.projects);
  expect(parseWorkspace(second.workspace)).toEqual(second.workspace);
  expect(w.nodes).toHaveLength(16);
});

it("剪切到其他导图保留节点 ID 和关联，保留内部连线并移除跨图边界", () => {
  const w = demo();
  w.maps.push({ id: "second", name: "第二张" });
  const clip = copyMapNodes(w, ["n5", "n10"], "cut");
  expect(w.nodes).toHaveLength(16); // pending cut does not remove data
  const edited = { ...w, nodes: w.nodes.map((n) => n.id === "n5" ? { ...n, title: "剪切后仍可编辑" } : n) };
  const result = pasteMapNodes(edited, clip, "second", { x: 0, y: 0 });
  expect(result.ids).toEqual(["n5", "n10"]);
  expect(result.workspace.nodes.find((n) => n.id === "n5")).toMatchObject({ title: "剪切后仍可编辑", mapId: "second" });
  expect(result.workspace.edges.some((e) => e.source === "n5" && e.target === "n10")).toBe(true);
  expect(result.workspace.edges.some((e) => e.source === "n4" && e.target === "n5")).toBe(false);
  expect(result.workspace.tasks).toEqual(w.tasks);
  expect(result.workspace.projects).toEqual(w.projects);
  expect(parseWorkspace(result.workspace)).toEqual(result.workspace);
});

it("同图剪切只移动位置并保留外部连线，剪切节点已删除时不粘贴旧副本", () => {
  const w = demo();
  const clip = copyMapNodes(w, ["n5"], "cut");
  const result = pasteMapNodes(w, clip, "main", { x: 900, y: 1000 });
  expect(result.workspace.edges).toEqual(w.edges);
  expect(result.workspace.nodes.find((n) => n.id === "n5")?.position).toEqual({ x: 900, y: 1000 });
  expect(() => pasteMapNodes(removeNodes(w, ["n5"]), clip, "main", { x: 0, y: 0 })).toThrow("剪切的节点已删除");
});

it("批量删除清理关联且保留任务、项目以及另一张图", () => {
  const w = demo();
  w.maps.push({ id: "second", name: "另一张" });
  const withOther = appendMapNode(w, { x: 100, y: 100 }, undefined, "任务关联", "second");
  const result = removeNodes(withOther, ["n5", "n10"]);
  expect(result.tasks).toHaveLength(w.tasks.length);
  expect(result.projects).toHaveLength(w.projects.length);
  expect(result.tasks.every((t) => t.nodeIds.every((id) => !["n5", "n10"].includes(id)))).toBe(true);
  expect(result.projects[0].nodeIds).not.toContain("n10");
  expect(result.nodes.at(-1)).toEqual(withOther.nodes.at(-1));
  expect(parseWorkspace(result)).toEqual(result);
});

it("拒绝不存在的导图、跨图连线和重复导图 ID", () => {
  const w = demo();
  expect(() => parseWorkspace({ ...w, maps: [] })).toThrow();
  expect(() => parseWorkspace({ ...w, maps: [...w.maps, w.maps[0]] })).toThrow("重复 ID");
  expect(() => appendMapNode(w, { x: 0, y: 0 }, undefined, "前置依赖", "missing")).toThrow();
  const invalid = { ...w, maps: [...w.maps, { id: "second", name: "另一张" }], nodes: w.nodes.map((n) => n.id === "n5" ? { ...n, mapId: "second" } : n) };
  expect(() => parseWorkspace(invalid)).toThrow("跨图连线");
});
