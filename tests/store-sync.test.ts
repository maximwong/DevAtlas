// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { demo, type Workspace } from "../src/model";
import { useAtlas, initialize, flushPending } from "../src/store";
type Snapshot = { workspace: Workspace; revision: string };
afterEach(async () => { delete window.atlas; await initialize(); vi.restoreAllMocks(); });

it("界面保存带版本，接口通知更新界面不回写，flush 等待待保存编辑完成", async () => {
  let snapshot: Snapshot = { workspace: demo(), revision: "r1" };
  let changed: ((s: Snapshot) => void) | undefined;
  let flush: (() => Promise<void>) | undefined;
  const commit = vi.fn(async (workspace: Workspace, revision: string) => {
    expect(revision).toBe(snapshot.revision);
    snapshot = { workspace, revision: "r2" }; return snapshot;
  });
  window.atlas = { read: async () => snapshot.workspace, save: vi.fn(), backup: async () => null,
    snapshot: async () => snapshot, commit, ready: vi.fn(async () => {}),
    onChanged: (fn) => { changed = fn; return () => { changed = undefined; }; },
    onFlush: (fn) => { flush = fn; return () => { flush = undefined; }; } };
  await initialize();
  const local = { ...useAtlas.getState().w, maps: [...snapshot.workspace.maps, { id: "local", name: "界面" }] };
  useAtlas.getState().set(local);
  await flush!();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(snapshot.workspace.maps.at(-1)?.id).toBe("local");
  snapshot = { workspace: { ...snapshot.workspace, maps: [...snapshot.workspace.maps, { id: "api", name: "接口" }] }, revision: "r3" };
  changed!(snapshot);
  expect(useAtlas.getState().w.maps.at(-1)?.id).toBe("api");
  await flushPending();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(window.atlas.save).not.toHaveBeenCalled();
});

it("外部通知遇到未保存的本地编辑时不覆盖，禁止自动回写直到重新读取", async () => {
  let snapshot: Snapshot = { workspace: demo(), revision: "r1" };
  let changed: ((s: Snapshot) => void) | undefined;
  const commit = vi.fn(async () => snapshot);
  window.atlas = { read: async () => snapshot.workspace, save: vi.fn(), backup: async () => null,
    snapshot: async () => snapshot, commit, onChanged: (fn) => { changed = fn; return () => {}; } };
  await initialize();
  useAtlas.getState().set({ ...snapshot.workspace, maps: [...snapshot.workspace.maps, { id: "local", name: "尚未保存" }] });
  snapshot = { workspace: { ...snapshot.workspace, maps: [...snapshot.workspace.maps, { id: "api", name: "接口已保存" }] }, revision: "r2" };
  changed!(snapshot);
  expect(useAtlas.getState().w.maps.at(-1)?.id).toBe("local");
  expect(useAtlas.getState().saveState).toContain("冲突");
  await expect(flushPending()).rejects.toThrow();
  expect(commit).not.toHaveBeenCalled();
  await initialize();
  expect(useAtlas.getState().w.maps.at(-1)?.id).toBe("api");
});
