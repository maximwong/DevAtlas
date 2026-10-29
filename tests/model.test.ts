import { describe, it, expect } from "vitest";
import {
  demo,
  parseWorkspace,
  newTask,
  moveTask,
  removeNode,
  progress,
  uid,
  appendMapNode,
} from "../src/model";
describe("workspace lifecycle", () => {
  it("在指定视野坐标创建节点，连续添加不重叠且不改动旧节点", () => {
    const original = { ...demo(), nodes: [], edges: [] };
    const first = appendMapNode(original, { x: 5000, y: -2000 });
    const second = appendMapNode(first, { x: 5000, y: -2000 });
    expect(first.nodes[0].position).toEqual({ x: 5000, y: -2000 });
    expect(second.nodes[1].position.y).toBeGreaterThan(first.nodes[0].position.y + 100);
    expect(original.nodes).toHaveLength(0);
    expect(second.nodes[0]).toEqual(first.nodes[0]);
  });
  it("添加多个子节点自动关联父节点，位置不重叠，能序列化读取", () => {
    const original = demo();
    const parent = original.nodes[0];
    const first = appendMapNode(original, { x: 0, y: 0 }, parent.id, "技术支撑");
    const second = appendMapNode(first, { x: 0, y: 0 }, parent.id, "技术支撑");
    const a = first.nodes.at(-1)!;
    const b = second.nodes.at(-1)!;
    expect(a.id).not.toBe(b.id);
    expect(a.position.x).toBe(parent.position.x + 280);
    expect(Math.abs(a.position.y - b.position.y)).toBeGreaterThanOrEqual(110);
    expect(second.edges.at(-1)).toMatchObject({ source: parent.id, target: b.id, type: "技术支撑" });
    expect(parseWorkspace(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(() => appendMapNode(original, { x: 0, y: 0 }, "missing")).toThrow("父节点不存在");
  });
  it("首次演示数据包含技术链与同步任务", () => {
    const w = demo();
    expect(w.nodes.some((n) => n.title === "YOLO")).toBe(true);
    expect(progress(w, "n5").total).toBe(3);
    expect(parseWorkspace(w)).toEqual(w);
  });
  it("创建节点并序列化持久化", () => {
    const w = demo();
    w.nodes.push({ ...w.nodes[0], id: uid(), title: "Rust" });
    expect(
      parseWorkspace(JSON.parse(JSON.stringify(w))).nodes.at(-1)?.title,
    ).toBe("Rust");
  });
  it("创建修改删除任务", () => {
    const w = demo();
    const t = newTask("测试");
    w.tasks.push(t);
    t.title = "修改";
    expect(w.tasks.at(-1)?.title).toBe("修改");
    w.tasks = w.tasks.filter((x) => x.id !== t.id);
    expect(w.tasks.some((x) => x.id === t.id)).toBe(false);
  });
  it("跨列移动与列内排序", () => {
    let w = demo();
    const [a, b] = w.tasks;
    w = moveTask(w, b.id, "Done", a.id);
    expect(w.tasks[0].id).toBe(b.id);
    expect(w.tasks[0].status).toBe("Done");
  });
  it("多对多绑定与即时进度", () => {
    let w = demo();
    const t = newTask("关联", ["n0", "n1"]);
    w.tasks.push(t);
    expect(progress(w, "n0").total).toBe(1);
    w = moveTask(w, t.id, "Done");
    expect(progress(w, "n0").percent).toBe(100);
    expect(progress(w, "n1").done).toBe(1);
    expect(progress(w, "n9").percent).toBe(0);
  });
  it("删除节点清理所有引用保留任务", () => {
    const original = demo();
    const w = removeNode(original, "n5");
    expect(w.tasks.length).toBe(original.tasks.length);
    expect(w.tasks.every((t) => !t.nodeIds.includes("n5"))).toBe(true);
    expect(w.edges.every((e) => e.source !== "n5" && e.target !== "n5")).toBe(
      true,
    );
    expect(parseWorkspace(w)).toEqual(w);
  });
  it("导入导出往返与结构拒绝", () => {
    const w = demo();
    expect(parseWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(() => parseWorkspace({ schemaVersion: 2 })).toThrow();
    w.nodes.push(w.nodes[0]);
    expect(() => parseWorkspace(w)).toThrow();
  });
  it("Sprint 创建分配", () => {
    const w = demo();
    w.sprints.push({
      id: "s1",
      name: "迭代 1",
      start: "2026-10-28",
      end: "2026-11-10",
    });
    w.tasks[0].sprintId = "s1";
    expect(parseWorkspace(w).tasks[0].sprintId).toBe("s1");
  });
});
