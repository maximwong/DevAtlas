import { describe, it, expect } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { boardCollisionDetection } from "../src/board";
import { demo, moveTask, newTask } from "../src/model";

type Args = Parameters<CollisionDetection>[0];
type Container = Args["droppableContainers"][number];
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}
function fixture(x: number, y: number): Args {
  const droppableContainers: Container[] = [];
  const droppableRects: Args["droppableRects"] = new Map();
  function add(id: string, kind: string, status: string, r: ReturnType<typeof rect>) {
    droppableContainers.push({ id, key: id, disabled: false, data: { current: { kind, status } }, node: { current: null }, rect: { current: r } });
    droppableRects.set(id, r);
  }
  add("Todo", "column", "Todo", rect(0, 0, 210, 1500));
  add("Done", "column", "Done", rect(230, 0, 210, 1500));
  for (let i = 0; i < 12; i++) add(`card-${i}`, "task", "Done", rect(242, 70 + i * 110, 186, 90));
  add("moving", "task", "Todo", rect(230, 0, 210, 1500));
  return { active: { id: "moving", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    pointerCoordinates: { x, y }, collisionRect: rect(10, 10, 180, 100), droppableContainers, droppableRects };
}
describe("整个分区都是落点，卡片只细化排序位置", () => {
  it.each([
    [240, 20, "Done"], // header
    [250, 100, "card-0"], // top card
    [250, 200, "card-1"], // middle card
    [250, 940, "Done"], // gap after many cards
    [250, 1300, "card-11"], // twelfth card
    [250, 1450, "Done"], // bottom whitespace
  ])("鼠标位于 (%i,%i) 时命中 %s", (x, y, expected) => {
    expect(boardCollisionDetection(fixture(x as number, y as number)).map((c) => c.id)).toEqual([expected]);
  });
  it("鼠标离开看板时不按旧卡片重叠面积误判成功", () => {
    expect(boardCollisionDetection(fixture(900, 20))).toEqual([]);
  });
  it("键盘拖动没有鼠标坐标时仍按矩形落入目标分区", () => {
    const args = fixture(0, 0);
    args.pointerCoordinates = null;
    args.collisionRect = rect(235, 5, 20, 20);
    expect(boardCollisionDetection(args)[0]?.id).toBe("Done");
  });
});

it("目标分区有 12 张卡片时，顶部或中部落点能移动任务并排序，空白处可追加", () => {
  const w = demo();
  const targetTasks = Array.from({ length: 12 }, (_, i) => ({ ...newTask(`目标任务${i}`), status: "Done" as const }));
  const moving = { ...newTask("待移动"), status: "Todo" as const };
  w.tasks = [moving, ...targetTasks];
  for (const before of [targetTasks[0].id, targetTasks[5].id, undefined]) {
    const next = moveTask(w, moving.id, "Done", before);
    expect(next.tasks).toHaveLength(13);
    expect(next.tasks.every((t) => t.status === "Done")).toBe(true);
    expect(new Set(next.tasks.map((t) => t.id)).size).toBe(13);
    if (before) expect(next.tasks.findIndex((t) => t.id === moving.id)).toBe(next.tasks.findIndex((t) => t.id === before) - 1);
    else expect(next.tasks.at(-1)?.id).toBe(moving.id);
  }
});
