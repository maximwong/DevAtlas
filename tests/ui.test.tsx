// @vitest-environment jsdom
import React from "react";
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { App } from "../src/main";
import { useAtlas, initialize } from "../src/store";
import { demo, parseWorkspace } from "../src/model";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.atlas;
});

function openProjects() {
  useAtlas.setState({ w: demo(), ready: true });
  render(<ReactFlowProvider><App /></ReactFlowProvider>);
  fireEvent.click(screen.getByRole("button", { name: "项目" }));
  fireEvent.click(screen.getByRole("button", { name: "＋ 项目" }));
}

it("Electron 不支持 prompt 时仍可新建项目、自动保存并重新读取", async () => {
  vi.spyOn(window, "prompt").mockImplementation(() => {
    throw new Error("prompt() is and will not be supported.");
  });
  openProjects();
  let saved: unknown = null;
  const save = vi.fn(async (value: unknown) => {
    saved = JSON.parse(JSON.stringify(value));
  });
  window.atlas = { read: async () => saved, backup: async () => null, save };
  fireEvent.change(screen.getByLabelText("项目名称"), {
    target: { value: "  新项目回归验证  " },
  });
  fireEvent.submit(screen.getByRole("dialog", { name: "新建项目" }));
  expect(window.prompt).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("名称").getAttribute("value")).toBe("新项目回归验证");
  const created = useAtlas.getState().w.projects.at(-1)!;
  expect(created.name).toBe("新项目回归验证");
  expect(created.id).toBeTruthy();
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(parseWorkspace(saved).projects.at(-1)?.id).toBe(created.id);
  cleanup();
  await initialize();
  render(<ReactFlowProvider><App /></ReactFlowProvider>);
  fireEvent.click(screen.getByRole("button", { name: "项目" }));
  expect(screen.getByRole("button", { name: "新项目回归验证 · 进行中" })).toBeTruthy();
});

it("新建项目拒绝空白名称，取消和 Escape 不产生项目，重开清空输入", () => {
  openProjects();
  const count = useAtlas.getState().w.projects.length;
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "   " } });
  expect((screen.getByRole("button", { name: "创建项目" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("dialog"));
  expect(useAtlas.getState().w.projects).toHaveLength(count);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "＋ 项目" }));
  expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "未提交项目" } });
  fireEvent.keyDown(screen.getByLabelText("项目名称"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useAtlas.getState().w.projects).toHaveLength(count);
});
it("通过任务详情绑定节点并完成任务，首页显示进度", () => {
  useAtlas.setState({ w: demo(), ready: true });
  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
  fireEvent.click(screen.getByText("＋ 新建任务"));
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "UI 验收任务" },
  });
  fireEvent.click(screen.getByLabelText("Python"));
  fireEvent.change(screen.getByLabelText("状态"), {
    target: { value: "Done" },
  });
  fireEvent.click(screen.getByText("保存任务"));
  const t = useAtlas.getState().w.tasks.find((t) => t.title === "UI 验收任务");
  expect(t?.nodeIds).toContain("n0");
  expect(t?.status).toBe("Done");
  expect(screen.getByText("1 / 4")).toBeTruthy();
  cleanup();
});
it("删除任务经过确认并保留节点", () => {
  useAtlas.setState({ w: demo(), ready: true });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
  fireEvent.click(screen.getByText("完成 YOLO 基础教程"));
  fireEvent.click(screen.getByText("删除"));
  expect(useAtlas.getState().w.tasks.length).toBe(2);
  expect(useAtlas.getState().w.nodes.length).toBe(16);
  cleanup();
  vi.restoreAllMocks();
});
