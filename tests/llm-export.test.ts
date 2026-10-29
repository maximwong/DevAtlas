import { it, expect } from "vitest";
import { demo, newTask } from "../src/model";
import { buildLLMContext, buildLLMFiles, explicitDependencies, descriptionSections } from "../src/llm-export";
import { executeTool } from "../src/automation";

it("项目导出包括传递依赖与必要引用，不带出无关项目、节点或任务", () => {
  const w = demo();
  w.projects[2].description = "UNRELATED_PRIVATE_NOTE";
  const t = { ...newTask("目标项目任务", ["n13"]), projectId: "p1",
    description: `主执行：CODEX\n玩家身份：军警总指挥\n依赖任务 ID：\n基础 → ${w.tasks[0].id}` };
  w.tasks.push(t);
  const c = buildLLMContext(w, "p1");
  expect(c.tasks.map((x) => x.id)).toEqual([w.tasks[0].id, t.id]);
  expect(c.tasks.find((x) => x.id === w.tasks[0].id)?.externalDependency).toBe(true);
  expect(c.nodes.map((x) => x.id).sort()).toEqual(["n5", "n10", "n13"].sort());
  expect(JSON.stringify(c)).not.toContain("UNRELATED_PRIVATE_NOTE");
  expect(c.tasks.find((x) => x.id === t.id)?.sections["玩家身份"]).toEqual(["军警总指挥"]);
  expect(c.tasks.find((x) => x.id === t.id)?.owner).toBe("CODEX");
  expect(c.warnings).toEqual([]);
});

it("依赖缺失和循环被标注，不编造已满足条件或自动开工建议", () => {
  const w = demo();
  const [a,b] = w.tasks;
  a.description = `依赖任务 ID：\nB → ${b.id}\n未知 → missing-task`;
  b.description = `开发依赖任务 ID：\nA → ${a.id}`;
  const c = buildLLMContext(w, "p0");
  expect(c.warnings.some((x) => x.code === "MISSING_DEPENDENCY")).toBe(true);
  expect(c.warnings.some((x) => x.code === "DEPENDENCY_CYCLE")).toBe(true);
  expect(c.summary.candidateTaskIds).toEqual([]);
  expect(c.tasks.find((x) => x.id === a.id)?.dependenciesSatisfied).toBe(false);
  expect(explicitDependencies("普通引用：A → not-a-dependency")).toEqual([]);
});

it("Markdown 与 JSON 来自同一快照，保留原文、状态、ID，并生成安全文件名", () => {
  const w = demo(); w.projects[0].name = '项目/测试:*?';
  w.tasks[0].description = "主执行：DSH\n验收标准：初期只有警察，警情内包含异常。";
  const exported = buildLLMFiles(w, { projectId: "p0", format: "both" });
  expect(exported.files).toHaveLength(2);
  const json = JSON.parse(exported.files.find((f) => f.name.endsWith(".json"))!.content);
  const md = exported.files.find((f) => f.name.endsWith(".md"))!.content;
  expect(md).toContain(json.exportId);
  expect(md).toContain(w.tasks[0].id);
  expect(md).toContain("初期只有警察");
  expect(json.tasks[0].status).toBe(w.tasks[0].status);
  expect(exported.files.every((f) => !/[<>:"/\\|?*]/.test(f.name))).toBe(true);
  expect(() => buildLLMContext(w, "missing")).toThrow("项目不存在");
  expect(descriptionSections("__proto__：普通文本")["__proto__"]).toEqual(["普通文本"]);
});

it("LLM 导出工具只读，不修改原工作区，任务和空导图完整保留", () => {
  const w = demo(); w.maps.push({ id: "empty", name: "空白导图" });
  const before = JSON.stringify(w);
  const result = executeTool(w, "workspace_export_llm", { format: "json" });
  expect(JSON.stringify(w)).toBe(before);
  expect(result.workspace).toEqual(w);
  const files = (result.result as ReturnType<typeof buildLLMFiles>).files;
  const exported = JSON.parse(files[0].content);
  expect(exported.maps.some((m: { id: string }) => m.id === "empty")).toBe(true);
  expect(exported.tasks).toHaveLength(w.tasks.length);
});
