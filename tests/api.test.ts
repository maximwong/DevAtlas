import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { demo } from "../src/model";
const { createRepository, startAutomation } = createRequire(import.meta.url)("../electron/automation.cjs");
const { run: runClient } = createRequire(import.meta.url)("../scripts/devatlas-cli.cjs");

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "devatlas-api-"));
  const file = join(dir, "workspace.json");
  await writeFile(file, JSON.stringify(demo()));
  const events: unknown[] = [];
  const repository = createRepository({ file, notify: (snapshot: unknown) => events.push(snapshot) });
  const api = await startAutomation({ repository, userData: dir });
  const discovery = JSON.parse(await readFile(api.discoveryFile, "utf8"));
  const request = (url: string, data?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; body: ReturnType<typeof JSON.parse> }>((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: api.port, path: url, method: data === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${discovery.token}`, "Content-Type": "application/json", ...headers } }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  return { dir, file, repository, api, request, events, async close() { await api.close(); await rm(dir, { recursive: true, force: true }); } };
}

it("真实 HTTP 创建操作持久化、发出界面通知、备份旧文件，重复请求不重复创建", async () => {
  const f = await fixture();
  try {
    const before = (await f.request("/v1/workspace")).body;
    const body = { tool: "maps_create", arguments: { name: "HTTP 创建" }, expectedRevision: before.revision, requestId: "create-once" };
    const a = await f.request("/v1/call", body);
    expect(a.status).toBe(200);
    expect(f.events).toHaveLength(1);
    expect(await f.request("/v1/call", body)).toEqual(a);
    expect(JSON.parse(await readFile(f.file, "utf8")).maps).toHaveLength(2);
    expect(JSON.parse(await readFile(f.file + ".bak", "utf8")).maps).toHaveLength(1);
    expect((await f.request("/v1/call", { ...body, arguments: { name: "不同请求" } })).body.error.code).toBe("REQUEST_ID_REUSED");
  } finally { await f.close(); }
});

it("版本冲突拒绝 GUI 与 API 覆盖彼此；并发写同一版本只成功一次", async () => {
  const f = await fixture();
  try {
    const initial = await f.repository.snapshot();
    const body = { tool: "maps_create", arguments: { name: "并发" }, expectedRevision: initial.revision };
    const replies = await Promise.all([f.request("/v1/call", { ...body, requestId: "a" }), f.request("/v1/call", { ...body, requestId: "b" })]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    await expect(f.repository.commit(initial.workspace, initial.revision)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await f.repository.snapshot()).workspace.maps).toHaveLength(2);
  } finally { await f.close(); }
});

it("预演不落盘；参数错误或无效节点引用不改变文件与版本", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.file, "utf8");
    const snapshot = await f.repository.snapshot();
    const preview = await f.request("/v1/call", { tool: "maps_create", arguments: { name: "只预演" }, expectedRevision: snapshot.revision, requestId: "preview", dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.dryRun).toBe(true);
    const invalid = await f.request("/v1/call", { tool: "tasks_create", arguments: { title: "无效", nodeIds: ["missing"] }, expectedRevision: snapshot.revision, requestId: "invalid" });
    expect(invalid.status).toBe(400);
    expect(await readFile(f.file, "utf8")).toBe(before);
    expect((await f.repository.snapshot()).revision).toBe(snapshot.revision);
    expect(f.events).toHaveLength(0);
  } finally { await f.close(); }
});

it("鉴权、Origin、Host、未知操作和体积限制，拒绝后服务仍可用", async () => {
  const f = await fixture();
  try {
    expect((await f.request("/v1/workspace", undefined, { Authorization: "" })).status).toBe(401);
    expect((await f.request("/v1/workspace", undefined, { Origin: "https://example.test" })).status).toBe(403);
    expect((await f.request("/v1/workspace", undefined, { Host: "evil.test" })).status).toBe(403);
    expect((await f.request("/v1/call", { tool: "toString" })).status).toBe(400);
    expect((await f.request("/v1/call", { tool: "maps_create", arguments: { name: "x" } })).status).toBe(400);
    expect((await f.request("/v1/call", { tool: "workspace_get", arguments: { huge: "x".repeat(1100000) } })).status).toBe(413);
    const tools = await f.request("/v1/tools");
    expect(tools.body.tools).toHaveLength(26);
    expect(JSON.stringify(tools.body)).not.toContain("Bearer");
    expect((await f.request("/v1/health")).status).toBe(200);
  } finally { await f.close(); }
});

it("界面待保存内容先刷新；版本过期时 API 不会覆盖刚保存的编辑", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devatlas-api-"));
  try {
    const file = join(dir, "workspace.json");
    const initial = demo(); await writeFile(file, JSON.stringify(initial));
    let pending = true;
    const repo = createRepository({ file, flush: async () => {
      if (pending) { pending = false; const s = await repo.snapshot(); await repo.commit({ ...s.workspace, maps: [...s.workspace.maps, { id: "gui", name: "界面修改" }] }, s.revision); }
    } });
    const s = await repo.snapshot();
    await expect(repo.call({ tool: "maps_create", arguments: { name: "API" }, expectedRevision: s.revision, requestId: "old" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await repo.snapshot()).workspace.maps.map((m: { name: string }) => m.name)).toContain("界面修改");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("损坏的工作区拒绝读取与写入，原文件不被覆盖", async () => {
  const dir = await mkdtemp(join(tmpdir(), "devatlas-api-"));
  try {
    const file = join(dir, "workspace.json"); await writeFile(file, "{broken");
    const repo = createRepository({ file });
    await expect(repo.snapshot()).rejects.toThrow();
    await expect(repo.commit(demo(), "x")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("CLI 通过真实 HTTP 导出两个 UTF-8 文件，包含同一导出 ID，工作区保持不变", async () => {
  const f = await fixture();
  try {
    const before = await readFile(f.file, "utf8");
    const directory = join(f.dir, "exports");
    const result = await runClient(["export", "--user-data", f.dir, "--project-id", "p0", "--output-dir", directory]);
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
    const jsonFile = result.files.find((x: { path: string }) => x.path.endsWith(".json"));
    const mdFile = result.files.find((x: { path: string }) => x.path.endsWith(".md"));
    const context = JSON.parse(await readFile(jsonFile.path, "utf8"));
    expect(context.scope.projectId).toBe("p0");
    expect(await readFile(mdFile.path, "utf8")).toContain(context.exportId);
    expect(await readFile(f.file, "utf8")).toBe(before);
    const token = JSON.parse(await readFile(f.api.discoveryFile, "utf8")).token;
    expect(JSON.stringify(context)).not.toContain(token);
  } finally { await f.close(); }
});
