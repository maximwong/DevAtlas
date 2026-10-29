import { pointerWithin, rectIntersection, type CollisionDetection } from "@dnd-kit/core";

export const taskTypeColors = {
  "开发": "#4f8ff7",
  "测试": "#f0a239",
  "学习": "#40b383",
  "Bug": "#e86a70",
  "研究": "#a47ae4",
} as const;
export function taskTypeColor(type: string): string {
  return Object.hasOwn(taskTypeColors, type)
    ? taskTypeColors[type as keyof typeof taskTypeColors]
    : "#8393a5";
}

// The pointer determines the column even when the dragged card still overlaps
// its old column. A card under the pointer refines the insertion position.
export const boardCollisionDetection: CollisionDetection = (args) => {
  const droppableContainers = args.droppableContainers.filter(
    (container) => !container.disabled && container.id !== args.active.id,
  );
  const candidates = { ...args, droppableContainers };
  const hits = args.pointerCoordinates
    ? pointerWithin(candidates)
    : rectIntersection(candidates);
  const task = hits.find((hit) =>
    droppableContainers.find((container) => container.id === hit.id)?.data.current?.kind === "task",
  );
  return task ? [task] : hits.slice(0, 1);
};
