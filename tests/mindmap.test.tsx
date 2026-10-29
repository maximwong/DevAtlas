// @vitest-environment jsdom
// Exercise the app's canvas adapter; real pointer dragging needs desktop acceptance.
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Node, ReactFlowProps } from "@xyflow/react";
import { App } from "../src/main";
import { useAtlas } from "../src/store";
import { demo, parseWorkspace } from "../src/model";

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p, setCenter: vi.fn(), getZoom: () => 1 }),
  Background: () => null, Controls: () => null, MiniMap: () => null,
  SelectionMode: { Partial: "partial" },
  ReactFlow: ({ nodes = [], onNodesChange, onConnect, selectionOnDrag }: ReactFlowProps<Node<{ label: React.ReactNode }>>) => (
    <div>
      {nodes.map((n) => <div key={n.id} onClick={(e) => {
        onNodesChange?.(nodes.map((x) => ({ type: "select" as const, id: x.id,
          selected: x.id === n.id || ((e.ctrlKey || e.shiftKey) && !!x.selected) })));
      }}>{n.data.label}</div>)}
      <button disabled={!selectionOnDrag} onClick={() => onNodesChange?.(nodes.map((n, i) => ({ type: "select", id: n.id, selected: i < 2 })))}>模拟框选两个节点</button>
      <button onClick={() => onNodesChange?.([{ type: "position", id: nodes[0].id, position: { x: 900, y: 800 } }])}>模拟节点移动</button>
      <button onClick={() => onConnect?.({ source: nodes[0].id, target: nodes[nodes.length - 1].id, sourceHandle: null, targetHandle: null })}>模拟端口连接</button>
    </div>
  ),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("搭建节点和分支、双击改名、移动和连线后自动保存且可重新解析", async () => {
  vi.spyOn(window, "prompt").mockImplementation(() => { throw Error("Electron prompt unsupported"); });
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0; });
  const initial = { ...demo(), nodes: [], edges: [], tasks: [], projects: [] };
  useAtlas.setState({ w: initial, ready: true });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "思维导图" }));
  expect((screen.getByRole("button", { name: "＋ 子节点" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "＋ 节点" }));
  fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "学习路线" } });
  const root = useAtlas.getState().w.nodes[0];
  fireEvent.click(screen.getByRole("button", { name: "＋ 子节点" }));
  fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "Python" } });
  fireEvent.click(screen.getByText("学习路线"));
  fireEvent.click(screen.getByRole("button", { name: "＋ 子节点" }));
  fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "CAD" } });
  fireEvent.doubleClick(screen.getByText("Python"));
  expect((screen.getByLabelText("节点名称") as HTMLInputElement).value).toBe("Python");
  fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "Python 基础" } });
  expect(window.prompt).not.toHaveBeenCalled();
  expect(useAtlas.getState().w.edges).toHaveLength(2);
  expect(useAtlas.getState().w.edges.every((e) => e.source === root.id)).toBe(true);
  fireEvent.change(screen.getByLabelText("连线关系"), { target: { value: "技术支撑" } });
  fireEvent.click(screen.getByRole("button", { name: "模拟端口连接" }));
  fireEvent.click(screen.getByRole("button", { name: "模拟端口连接" }));
  expect(useAtlas.getState().w.edges).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "模拟节点移动" }));
  expect(useAtlas.getState().w.nodes[0].position).toEqual({ x: 900, y: 800 });
  await waitFor(() => expect(useAtlas.getState().saveState).toBe("已自动保存"));
  const saved = parseWorkspace(JSON.parse(localStorage.getItem("devatlas")!));
  expect(saved.nodes.map((n) => n.title)).toEqual(["学习路线", "Python 基础", "CAD"]);
  expect(saved.edges).toHaveLength(3);
  expect(saved.nodes[0].position).toEqual({ x: 900, y: 800 });
  vi.unstubAllGlobals();
});

it("新建和重命名多张导图、框选跨图复制粘贴、剪切移动及批量删除", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  useAtlas.setState({ w: demo(), ready: true });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "思维导图" }));
  fireEvent.click(screen.getByRole("button", { name: "模拟框选两个节点" }));
  expect(screen.getByText("16 个节点 · 已选 2 个")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "复制 Ctrl+C" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ 新建导图" }));
  fireEvent.change(screen.getByLabelText("导图名称"), { target: { value: "第二张" } });
  fireEvent.click(screen.getByRole("button", { name: "保存导图" }));
  expect(screen.queryByText("Python")).toBeNull();
  expect(screen.getByText("0 个节点 · 已选 0 个")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重命名导图" }));
  fireEvent.change(screen.getByLabelText("导图名称"), { target: { value: "实验图" } });
  fireEvent.click(screen.getByRole("button", { name: "保存导图" }));
  fireEvent.click(screen.getByRole("button", { name: "粘贴 Ctrl+V" }));
  expect(screen.getByText("2 个节点 · 已选 2 个")).toBeTruthy();
  const secondId = useAtlas.getState().w.maps[1].id;
  const copies = useAtlas.getState().w.nodes.filter((n) => n.mapId === secondId);
  expect(copies.map((n) => n.id)).not.toContain("n0");
  // Text editing shortcuts must not delete or select canvas nodes.
  fireEvent.click(screen.getByText("Python"));
  const title = screen.getByLabelText("节点名称");
  fireEvent.keyDown(title, { key: "Delete" });
  fireEvent.keyDown(title, { key: "a", ctrlKey: true });
  expect(confirm).not.toHaveBeenCalled();
  expect(useAtlas.getState().w.nodes).toHaveLength(18);
  const canvas = screen.getByLabelText("思维导图画布");
  fireEvent.keyDown(canvas, { key: "a", ctrlKey: true });
  fireEvent.keyDown(canvas, { key: "x", ctrlKey: true });
  expect(useAtlas.getState().w.nodes).toHaveLength(18); // cut is pending until paste
  fireEvent.change(screen.getByLabelText("当前思维导图"), { target: { value: "main" } });
  fireEvent.keyDown(screen.getByLabelText("思维导图画布"), { key: "v", ctrlKey: true });
  expect(useAtlas.getState().w.nodes.filter((n) => n.mapId === secondId)).toHaveLength(0);
  expect(copies.every((n) => useAtlas.getState().w.nodes.some((x) => x.id === n.id))).toBe(true);
  fireEvent.keyDown(screen.getByLabelText("思维导图画布"), { key: "Delete" });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(useAtlas.getState().w.nodes).toHaveLength(16);
  expect(useAtlas.getState().w.tasks).toHaveLength(3);
  await waitFor(() => expect(useAtlas.getState().saveState).toBe("已自动保存"));
  const saved = parseWorkspace(JSON.parse(localStorage.getItem("devatlas")!));
  expect(saved.maps[1]).toEqual({ id: secondId, name: "实验图" });
  expect(saved.nodes).toHaveLength(16);
});
