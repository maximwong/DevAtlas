import { create } from "zustand";
import { demo, parseWorkspace, type Workspace } from "./model";
type Snapshot = { workspace: unknown; revision: string };
declare global {
  interface Window {
    atlas?: {
      read: () => Promise<unknown>;
      backup: () => Promise<unknown>;
      save: (data: Workspace) => Promise<void>;
      snapshot?: () => Promise<Snapshot>;
      commit?: (data: Workspace, revision: string) => Promise<Snapshot>;
      ready?: () => Promise<void>;
      onChanged?: (callback: (snapshot: Snapshot) => void) => () => void;
      onFlush?: (callback: () => Promise<void>) => () => void;
    };
  }
}
export const useAtlas = create<{
  w: Workspace;
  ready: boolean;
  saveState: string;
  set: (w: Workspace) => void;
}>((set) => ({
  w: demo(),
  ready: false,
  saveState: "正在读取",
  set: (w) => set({ w }),
}));
let chain = Promise.resolve();
let timer: ReturnType<typeof setTimeout>;
let blocked = false;
let dirty = false;
let applying = false;
let inFlight = false;
let revision = "";
let unsubscribers: (() => void)[] = [];
function applySnapshot(snapshot: Snapshot) {
  const w = parseWorkspace(snapshot.workspace);
  if (typeof snapshot.revision !== "string") throw Error("工作区版本无效");
  applying = true;
  try {
    revision = snapshot.revision;
    useAtlas.setState({ w, ready: true, saveState: "已同步接口操作" });
  } finally { applying = false; }
}
export async function initialize() {
  clearTimeout(timer);
  await chain.catch(() => {});
  unsubscribers.forEach((fn) => fn()); unsubscribers = [];
  try {
    dirty = false; blocked = false;
    const raw = window.atlas?.snapshot ? await window.atlas.snapshot() : window.atlas
      ? await window.atlas.read()
      : JSON.parse(localStorage.getItem("devatlas") || "null");
    if (window.atlas?.snapshot) applySnapshot(raw as Snapshot);
    else {
      applying = true;
      try { useAtlas.setState({ w: raw ? parseWorkspace(raw) : demo(), ready: true, saveState: "已读取" }); }
      finally { applying = false; }
    }
    if (window.atlas?.onChanged) unsubscribers.push(window.atlas.onChanged((snapshot) => {
      if (dirty || inFlight || blocked) {
        blocked = true;
        useAtlas.setState({ saveState: "发生保存冲突：本地编辑已保留，请先导出 JSON，再重新读取" });
      } else {
        try { applySnapshot(snapshot); }
        catch { blocked = true; useAtlas.setState({ saveState: "接口数据读取失败，请重新读取" }); }
      }
    }));
    if (window.atlas?.onFlush) unsubscribers.push(window.atlas.onFlush(flushPending));
    await window.atlas?.ready?.();
  } catch {
    blocked = true;
    useAtlas.setState({
      saveState: "读取失败：请导入文件或恢复备份；未覆盖原文件",
      ready: true,
    });
  }
}
useAtlas.subscribe((s, prev) => {
  if (applying || !s.ready || s.w === prev.w) return;
  dirty = true;
  if (blocked) return;
  clearTimeout(timer);
  useAtlas.setState({ saveState: "等待保存…" });
  timer = setTimeout(() => { void flushPending().catch(() => {}); }, 250);
});
export function flushPending(): Promise<void> {
  clearTimeout(timer);
  chain = chain.catch(() => {}).then(async () => {
    if (blocked) throw Error("存在未解决的读取或保存冲突");
    while (dirty) {
      const w = useAtlas.getState().w;
      dirty = false; inFlight = true;
      try {
        if (window.atlas?.commit && window.atlas.snapshot) {
          const saved = await window.atlas.commit(w, revision);
          revision = saved.revision;
        } else if (window.atlas) await window.atlas.save(w);
        else localStorage.setItem("devatlas", JSON.stringify(w));
        if (blocked) throw Error("保存期间发生并发修改");
      } catch (error) {
        dirty = true; blocked = true;
        useAtlas.setState({ saveState: "保存失败或发生冲突：编辑已保留，请导出 JSON 后重新读取" });
        throw error;
      } finally { inFlight = false; }
    }
    useAtlas.setState({ saveState: "已自动保存" });
  });
  return chain;
}
