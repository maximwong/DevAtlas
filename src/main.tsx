import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  useDndContext,
  type DragEndEvent,
} from "@dnd-kit/core";
import "@xyflow/react/dist/style.css";
import "./style.css";
import { boardCollisionDetection, taskTypeColors, taskTypeColor } from "./board";
import { useAtlas, initialize, flushPending } from "./store";
import { buildLLMFiles } from "./llm-export";
import {
  uid,
  appendMapNode,
  newTask,
  progress,
  removeNode,
  removeNodes,
  copyMapNodes,
  pasteMapNodes,
  moveTask,
  parseWorkspace,
  statuses,
  nodeTypes,
  relations,
  type Task,
  type AtlasNode,
  type MapClipboard,
} from "./model";
export function App() {
  const { w, set, saveState, ready } = useAtlas();
  const [llmExportOpen, setLlmExportOpen] = useState(false);
  const [llmScope, setLlmScope] = useState("");
  const [llmFormat, setLlmFormat] = useState<"markdown" | "json">("markdown");
  const [llmExportBusy, setLlmExportBusy] = useState(false);
  const [page, P] = useState("首页");
  const [selectedIds, selectIds] = useState<string[]>([]);
  const [selectedEdgeIds, selectEdges] = useState<string[]>([]);
  const [mapId, setMapId] = useState("main");
  const [mapDraft, setMapDraft] = useState<{ id?: string; name: string } | null>(null);
  const [clipboard, setClipboard] = useState<MapClipboard | null>(null);
  const [mapNotice, setMapNotice] = useState("");
  const pasteCount = useRef(0);
  const activeMapId = w.maps.some((m) => m.id === mapId) ? mapId : w.maps[0].id;
  const visibleNodes = w.nodes.filter((n) => n.mapId === activeMapId);
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = w.edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  const activeSelection = selectedIds.filter((id) => visibleNodeIds.has(id));
  const activeEdgeSelection = selectedEdgeIds.filter((id) => visibleEdges.some((e) => e.id === id));
  const selected = activeSelection.length === 1 ? activeSelection[0] : "";
  const S = (id: string) => selectIds(id ? [id] : []);
  const [task, T] = useState<Task | null>(null);
  const [project, SP] = useState("");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [filter, F] = useState({ project: "", type: "", priority: "" });
  const [search, Q] = useState("");
  const [rel, R] = useState<(typeof relations)[number]>("前置依赖");
  const [theme, TH] = useState("system");
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeTitleRef = useRef<HTMLInputElement>(null);
  const node = w.nodes.find((n) => n.id === selected);
  const editNodeTitle = (id: string) => {
    S(id);
    requestAnimationFrame(() => {
      nodeTitleRef.current?.focus();
      nodeTitleRef.current?.select();
    });
  };
  const addMapNode = (parentId?: string) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const position = rect && rect.width && rect.height
      ? flow.screenToFlowPosition({
          x: rect.left + rect.width / 2 - 100,
          y: rect.top + rect.height / 2 - 35,
        })
      : { x: 100, y: 100 };
    const next = appendMapNode(useAtlas.getState().w, position, parentId, rel, activeMapId);
    const created = next.nodes[next.nodes.length - 1];
    set(next);
    editNodeTitle(created.id);
    void flow.setCenter(created.position.x + 100, created.position.y + 35, {
      zoom: Math.max(flow.getZoom(), 0.8), duration: 200,
    });
  };
  const patchNode = (v: Partial<AtlasNode>) =>
    set({
      ...w,
      nodes: w.nodes.map((n) => (n.id === selected ? { ...n, ...v } : n)),
    });
  const navigate = (id: string) => {
    selectEdges([]);
    const target = w.nodes.find((n) => n.id === id);
    if (target) setMapId(target.mapId);
    S(id);
    P("思维导图");
    setTimeout(() => {
      const n = w.nodes.find((n) => n.id === id);
      if (n)
        flow.setCenter(n.position.x + 100, n.position.y + 35, {
          zoom: 1,
          duration: 300,
        });
    }, 150);
  };
  const addTask = (ids: string[] = []) => T(newTask("新任务", ids));
  const copySelection = (mode: "copy" | "cut") => {
    if (!activeSelection.length) return;
    setClipboard(copyMapNodes(useAtlas.getState().w, activeSelection, mode));
    pasteCount.current = 0;
    setMapNotice(mode === "cut" ? `已标记剪切 ${activeSelection.length} 个节点；粘贴时移动，Esc 取消` : `已复制 ${activeSelection.length} 个节点，可切换导图粘贴`);
  };
  const pasteSelection = () => {
    if (!clipboard?.nodes.length) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = rect && rect.width && rect.height
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 100, y: 100 };
    const offset = 40 * ++pasteCount.current;
    try {
      const result = pasteMapNodes(useAtlas.getState().w, clipboard, activeMapId, { x: center.x + offset, y: center.y + offset });
      set(result.workspace);
      selectIds(result.ids);
      selectEdges([]);
      if (clipboard.mode === "cut") setClipboard(null);
      setMapNotice(`已粘贴 ${result.ids.length} 个节点`);
      void flow.setCenter(center.x + offset + 100, center.y + offset + 35, { zoom: Math.max(flow.getZoom(), 0.8), duration: 200 });
    } catch (error) { setMapNotice(String(error)); }
  };
  const deleteSelection = () => {
    if (!activeSelection.length && !activeEdgeSelection.length) return;
    if (!confirm(`删除选中的 ${activeSelection.length} 个节点和相关连线？任务和项目将保留，节点关联会清理。`)) return;
    const next = removeNodes(useAtlas.getState().w, activeSelection);
    set({ ...next, edges: next.edges.filter((e) => !activeEdgeSelection.includes(e.id)) });
    selectIds([]); selectEdges([]);
    if (clipboard?.mode === "cut" && clipboard.nodes.some((n) => activeSelection.includes(n.id))) setClipboard(null);
    setMapNotice("已删除所选内容");
  };
  const p = progress(w);
  const filtered = w.tasks.filter(
    (t) =>
      (!filter.project || t.projectId === filter.project) &&
      (!filter.type || t.type === filter.type) &&
      (!filter.priority || t.priority === filter.priority),
  );
  function drag(e: DragEndEvent) {
    if (!e.over) return;
    const current = useAtlas.getState().w;
    const over = String(e.over.id);
    if (over === String(e.active.id)) return;
    const target = current.tasks.find((t) => t.id === over);
    const status = target?.status || (over as Task["status"]);
    if (statuses.includes(status))
      set(moveTask(current, String(e.active.id), status, target?.id));
  }
  return (
    <div className="app" data-theme={theme} onKeyDown={(e) => {
      if (page !== "思维导图" || (e.target instanceof HTMLElement && e.target.closest("input,textarea,select,[contenteditable='true'],.modal"))) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && ["a", "c", "x", "v"].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (key === "a") selectIds(visibleNodes.map((n) => n.id));
        if (key === "c") copySelection("copy");
        if (key === "x") copySelection("cut");
        if (key === "v") pasteSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopPropagation(); deleteSelection();
      } else if (e.key === "Escape") {
        selectIds([]); selectEdges([]);
        if (clipboard?.mode === "cut") { setClipboard(null); setMapNotice("已取消剪切"); }
      }
    }}>
      <aside>
        <h1>◈ DevAtlas</h1>
        <small>构建你的技术版图</small>
        {["首页", "思维导图", "Scrum 看板", "项目"].map((x) => (
          <button
            className={page === x ? "active" : ""}
            onClick={() => P(x)}
            key={x}
          >
            {x}
          </button>
        ))}
        <footer>
          <select value={theme} onChange={(e) => TH(e.target.value)}>
            <option value="system">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
          <p>{saveState}</p>
          {(saveState.includes("冲突") || saveState.includes("读取失败")) && <button onClick={() => {
            if (confirm("重新读取将放弃尚未保存的本地编辑，请先导出 JSON。继续？")) void initialize();
          }}>重新读取工作区</button>}
          <button
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(
                new Blob([JSON.stringify(w, null, 2)], {
                  type: "application/json",
                }),
              );
              a.download = "devatlas.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            导出 JSON
          </button>
          <button disabled={!ready} onClick={() => { setLlmScope(project || ""); setLlmExportOpen(true); }}>导出 LLM 文件</button>
          <label className="button">
            导入 JSON
            <input
              type="file"
              accept=".json"
              hidden
              onChange={async (e) => {
                try {
                  const file = e.target.files?.[0];
                  if (file && confirm("导入将替换当前工作空间，建议先导出。"))
                    set(parseWorkspace(JSON.parse(await file.text())));
                } catch (err) {
                  alert("导入失败：" + err);
                }
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={async () => {
              try {
                if (!window.atlas) throw Error("仅桌面版支持备份");
                const raw = await window.atlas.backup();
                if (raw && confirm("恢复最近备份？")) set(parseWorkspace(raw));
                else if (!raw) alert("暂无备份");
              } catch (e) {
                alert(String(e));
              }
            }}
          >
            恢复备份
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <div>
            <small>PERSONAL DEVELOPMENT WORKSPACE</small>
            <h2>{page}</h2>
          </div>
          <button onClick={() => addTask()}>＋ 新建任务</button>
        </header>
        {page === "首页" && (
          <>
            <section className="stats">
              {[
                ["任务完成", `${p.done} / ${p.total}`],
                ["总体进度", `${p.percent}%`],
                ["技术节点", w.nodes.length],
                [
                  "活跃项目",
                  w.projects.filter((p) => p.status !== "完成").length,
                ],
              ].map(([a, b]) => (
                <article key={a}>
                  <small>{a}</small>
                  <h1>{b}</h1>
                </article>
              ))}
            </section>
            <div className="grid">
              <article>
                <h3>技术方向</h3>
                <div className="chips">
                  {w.nodes
                    .filter((n) => n.type === "技术 / 知识")
                    .map((n) => (
                      <button onClick={() => navigate(n.id)} key={n.id}>
                        {n.title}
                      </button>
                    ))}
                </div>
                <button onClick={() => P("思维导图")}>打开技术画布 →</button>
              </article>
              <article>
                <h3>近期任务</h3>
                {w.tasks
                  .filter((t) => t.status !== "Done")
                  .slice(0, 6)
                  .map((t) => (
                    <button className="row" key={t.id} onClick={() => T(t)}>
                      {t.title}
                      <small>{t.due || t.status}</small>
                    </button>
                  ))}
                <button onClick={() => P("Scrum 看板")}>进入看板 →</button>
              </article>
              <article>
                <h3>项目</h3>
                {w.projects.map((p) => (
                  <button
                    className="row"
                    key={p.id}
                    onClick={() => {
                      SP(p.id);
                      P("项目");
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </article>
              <article>
                <h3>Sprint 进度</h3>
                {w.sprints.map((s) => {
                  const ts = w.tasks.filter((t) => t.sprintId === s.id);
                  return (
                    <p key={s.id}>
                      {s.name} · {s.start} → {s.end}
                      <br />
                      {ts.filter((t) => t.status === "Done").length} /{" "}
                      {ts.length} 完成
                    </p>
                  );
                })}
              </article>
            </div>
          </>
        )}
        {page === "思维导图" && (
          <>
            <div className="toolbar">
              <label className="map-switch">思维导图
                <select aria-label="当前思维导图" value={activeMapId} onChange={(e) => {
                  setMapId(e.target.value); selectIds([]); selectEdges([]); setMapNotice("");
                }}>
                  {w.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <button onClick={() => setMapDraft({ name: "" })}>＋ 新建导图</button>
              <button onClick={() => setMapDraft({ id: activeMapId, name: w.maps.find((m) => m.id === activeMapId)!.name })}>重命名导图</button>
              <span>{visibleNodes.length} 个节点 · 已选 {activeSelection.length} 个</span>
            </div>
            <div className="toolbar">
              <button onClick={() => addMapNode()}>
                ＋ 节点
              </button>
              <button disabled={!node} onClick={() => node && addMapNode(node.id)}>
                ＋ 子节点
              </button>
              <select
                aria-label="连线关系"
                value={rel}
                onChange={(e) => R(e.target.value as typeof rel)}
              >
                {relations.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const indegree = new Map(visibleNodes.map((n) => [n.id, 0]));
                  visibleEdges.forEach((e) =>
                    indegree.set(e.target, (indegree.get(e.target) || 0) + 1),
                  );
                  const depths = new Map<string, number>();
                  const queue = visibleNodes
                    .filter((n) => !indegree.get(n.id))
                    .map((n) => n.id);
                  queue.forEach((id) => depths.set(id, 0));
                  for (let i = 0; i < queue.length; i++) {
                    for (const e of visibleEdges.filter(
                      (e) => e.source === queue[i],
                    )) {
                      depths.set(
                        e.target,
                        Math.max(
                          depths.get(e.target) || 0,
                          (depths.get(e.source) || 0) + 1,
                        ),
                      );
                      indegree.set(e.target, (indegree.get(e.target) || 1) - 1);
                      if (!indegree.get(e.target)) queue.push(e.target);
                    }
                  }
                  const rows: Record<number, number> = {};
                  set({
                    ...w,
                    nodes: w.nodes.map((n) => {
                      if (n.mapId !== activeMapId) return n;
                      const d = depths.get(n.id) || 0;
                      const row = rows[d] || 0;
                      rows[d] = row + 1;
                      return { ...n, position: { x: d * 270, y: row * 125 } };
                    }),
                  });
                }}
              >
                简单树状布局
              </button>
              <button disabled={!activeSelection.length} onClick={() => copySelection("copy")}>复制 Ctrl+C</button>
              <button disabled={!activeSelection.length} onClick={() => copySelection("cut")}>剪切 Ctrl+X</button>
              <button disabled={!clipboard?.nodes.length} onClick={pasteSelection}>粘贴 Ctrl+V</button>
              <button className="danger" disabled={!activeSelection.length && !activeEdgeSelection.length} onClick={deleteSelection}>删除 Delete</button>
              <span>空白处左键拖动框选 · Ctrl / Shift 加选 · 中键或右键平移 · Ctrl+A 全选 · 双击改名</span>
            </div>
            <p className="map-notice" role="status">{mapNotice || "复制和剪切可跨导图粘贴；复制保留内部连线，剪切粘贴后保留任务关联。"}</p>
            <div className="canvas" ref={canvasRef} tabIndex={0} aria-label="思维导图画布" onPointerDownCapture={(e) => {
              if (!(e.target instanceof HTMLElement && e.target.closest("input,textarea,select,button,.inspector"))) canvasRef.current?.focus({ preventScroll: true });
            }}>
              <ReactFlow
                key={activeMapId}
                selectionOnDrag
                selectionMode={SelectionMode.Partial}
                panOnDrag={[1, 2]}
                multiSelectionKeyCode={["Control", "Meta", "Shift"]}
                deleteKeyCode={null}
                nodes={visibleNodes.map((n) => ({
                  id: n.id,
                  selected: activeSelection.includes(n.id),
                  deletable: false,
                  position: n.position,
                  data: {
                    label: (
                      <div
                        onDoubleClick={() => editNodeTitle(n.id)}
                      >
                        <small>{n.type}</small>
                        <strong>{n.title}</strong>
                        <small>
                          {progress(w, n.id).done}/{progress(w, n.id).total}{" "}
                          任务 · {progress(w, n.id).percent}%
                        </small>
                      </div>
                    ),
                  },
                  style: { borderColor: n.color, borderTopWidth: 4,
                    opacity: clipboard?.mode === "cut" && clipboard.nodes.some((x) => x.id === n.id) ? 0.45 : 1 },
                }))}
                edges={visibleEdges.map((e) => ({
                  ...e,
                  selected: selectedEdgeIds.includes(e.id),
                  type: "default",
                  label: e.type,
                  style: {
                    stroke: ["#5b9de0", "#54b8ac", "#9c87ef", "#dfae48"][
                      relations.indexOf(e.type)
                    ],
                    strokeDasharray: e.type === "任务关联" ? "5 4" : undefined,
                  },
                }))}
                onNodesChange={(changes) => {
                  const selections = changes.filter((c) => c.type === "select");
                  if (selections.length) selectIds((prev) => {
                    const ids = new Set(prev);
                    for (const change of selections) {
                      if (change.selected) ids.add(change.id); else ids.delete(change.id);
                    }
                    return [...ids];
                  });
                  const positions = new Map(changes.flatMap((c) =>
                    c.type === "position" && c.position ? [[c.id, c.position] as const] : [],
                  ));
                  const current = useAtlas.getState().w;
                  if (!current.nodes.some((n) => {
                    const p = positions.get(n.id);
                    return p && (p.x !== n.position.x || p.y !== n.position.y);
                  })) return;
                  set({
                    ...current,
                    nodes: current.nodes.map((n) => ({
                      ...n,
                      position: positions.get(n.id) || n.position,
                    })),
                  });
                }}
                onEdgesChange={(changes) => {
                  const selections = changes.filter((c) => c.type === "select");
                  if (selections.length) selectEdges((prev) => {
                    const ids = new Set(prev);
                    for (const change of selections) {
                      if (change.selected) ids.add(change.id); else ids.delete(change.id);
                    }
                    return [...ids];
                  });
                }}
                onEdgesDelete={(edges) =>
                  set({
                    ...w,
                    edges: w.edges.filter(
                      (e) => !edges.some((x) => x.id === e.id),
                    ),
                  })
                }
                onConnect={(c) => {
                  const current = useAtlas.getState().w;
                  if (c.source && c.target && visibleNodeIds.has(c.source) && visibleNodeIds.has(c.target) && c.source !== c.target &&
                    !current.edges.some((e) => e.source === c.source && e.target === c.target && e.type === rel))
                    set({
                      ...current,
                      edges: [
                        ...current.edges,
                        {
                          id: uid(),
                          source: c.source,
                          target: c.target,
                          type: rel,
                        },
                      ],
                    });
                }}
                fitView
              >
                <Background />
                <Controls />
                <MiniMap />
              </ReactFlow>
              {node && (
                <section className="inspector">
                  <button onClick={() => S("")}>关闭</button>
                  <h3>节点详情</h3>
                  <input
                    ref={nodeTitleRef}
                    aria-label="节点名称"
                    value={node.title}
                    onChange={(e) =>
                      patchNode({ title: e.target.value || "未命名" })
                    }
                  />
                  <textarea
                    aria-label="节点描述"
                    value={node.description}
                    onChange={(e) => patchNode({ description: e.target.value })}
                  />
                  <select
                    value={node.type}
                    onChange={(e) =>
                      patchNode({ type: e.target.value as AtlasNode["type"] })
                    }
                  >
                    {nodeTypes.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    type="color"
                    value={node.color}
                    onChange={(e) => patchNode({ color: e.target.value })}
                  />
                  <h4>关联任务</h4>
                  {w.tasks
                    .filter((t) => t.nodeIds.includes(node.id))
                    .map((t) => (
                      <button className="row" key={t.id} onClick={() => T(t)}>
                        {t.title} · {t.status}
                      </button>
                    ))}
                  <button onClick={() => addTask([node.id])}>
                    ＋ 关联任务
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      if (confirm("删除节点并清理关联？任务将保留。")) {
                        set(removeNode(w, node.id));
                        S("");
                      }
                    }}
                  >
                    删除节点
                  </button>
                </section>
              )}
            </div>
          </>
        )}
        {page === "Scrum 看板" && (
          <>
            <div className="toolbar">
              <select
                value={filter.project}
                onChange={(e) => F({ ...filter, project: e.target.value })}
              >
                <option value="">全部项目</option>
                {w.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={filter.type}
                onChange={(e) => F({ ...filter, type: e.target.value })}
              >
                <option value="">全部类型</option>
                {["学习", "开发", "测试", "Bug", "研究"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                value={filter.priority}
                onChange={(e) => F({ ...filter, priority: e.target.value })}
              >
                <option value="">全部优先级</option>
                {["高", "中", "低"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const name = prompt("Sprint 名称");
                  if (!name?.trim()) return;
                  const start = prompt(
                    "开始日期 YYYY-MM-DD",
                    new Date().toISOString().slice(0, 10),
                  );
                  const end = prompt("结束日期 YYYY-MM-DD");
                  if (
                    !start ||
                    !end ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
                    end < start
                  ) {
                    alert("日期无效");
                    return;
                  }
                  set({
                    ...w,
                    sprints: [...w.sprints, { id: uid(), name, start, end }],
                  });
                }}
              >
                ＋ Sprint
              </button>
              <span>
                {p.done}/{p.total} 完成 · {p.percent}%
              </span>
            </div>
            <div className="task-type-legend" aria-label="任务类型颜色图例">
              <small>任务类型</small>
              {Object.entries(taskTypeColors).map(([type, color]) => (
                <span className="task-type-badge" key={type} style={{ backgroundColor: color + "24", borderColor: color + "88" }}>
                  <span className="task-color-dot" style={{ backgroundColor: color }} />{type}
                </span>
              ))}
            </div>
            <DndContext onDragEnd={drag} collisionDetection={boardCollisionDetection}>
              <div className="board-scroll">
              <div className="board" aria-label="Scrum 任务分区">
                {statuses.map((s) => (
                  <Column
                    key={s}
                    status={s}
                    tasks={filtered.filter((t) => t.status === s)}
                    edit={T}
                  />
                ))}
              </div>
              </div>
            </DndContext>
            <article>
              <h3>Sprint 完成情况</h3>
              {w.sprints.map((s) => {
                const ts = w.tasks.filter((t) => t.sprintId === s.id);
                return (
                  <p key={s.id}>
                    {s.name}（{s.start} — {s.end}）：
                    {ts.filter((t) => t.status === "Done").length}/{ts.length}
                  </p>
                );
              })}
            </article>
          </>
        )}
        {page === "项目" && (
          <div className="grid">
            <article>
              <h3>项目列表</h3>
              {w.projects.map((p) => (
                <button className="row" key={p.id} onClick={() => SP(p.id)}>
                  {p.name} · {p.status}
                </button>
              ))}
              <button onClick={() => setProjectName("")}>
                ＋ 项目
              </button>
            </article>
            {w.projects
              .filter((p) => p.id === project)
              .map((p) => {
                const patch = (v: Partial<typeof p>) =>
                  set({
                    ...w,
                    projects: w.projects.map((x) =>
                      x.id === p.id ? { ...x, ...v } : x,
                    ),
                  });
                const ts = w.tasks.filter((t) => t.projectId === p.id);
                return (
                  <article key={p.id}>
                    <h3>项目详情</h3>
                    <label>
                      名称
                      <input
                        value={p.name}
                        onChange={(e) =>
                          patch({ name: e.target.value || "未命名" })
                        }
                      />
                    </label>
                    <label>
                      描述
                      <textarea
                        value={p.description}
                        onChange={(e) => patch({ description: e.target.value })}
                      />
                    </label>
                    <label>
                      状态
                      <select
                        value={p.status}
                        onChange={(e) => patch({ status: e.target.value })}
                      >
                        {["进行中", "规划", "完成", "暂停"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      优先级
                      <select
                        value={p.priority}
                        onChange={(e) => patch({ priority: e.target.value })}
                      >
                        {["高", "中", "低"].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      目标日期
                      <input
                        type="date"
                        value={p.due}
                        onChange={(e) => patch({ due: e.target.value })}
                      />
                    </label>
                    <label>
                      GitHub URL
                      <input
                        value={p.url}
                        onChange={(e) => patch({ url: e.target.value })}
                      />
                    </label>
                    <small>创建于 {p.createdAt.slice(0, 10)}</small>
                    <h4>技术节点</h4>
                    {w.nodes.map((n) => (
                      <label className="check" key={n.id}>
                        <input
                          type="checkbox"
                          checked={p.nodeIds.includes(n.id)}
                          onChange={(e) =>
                            patch({
                              nodeIds: e.target.checked
                                ? [...p.nodeIds, n.id]
                                : p.nodeIds.filter((id) => id !== n.id),
                            })
                          }
                        />
                        {n.title}
                        <button onClick={() => navigate(n.id)}>定位</button>
                      </label>
                    ))}
                    <h4>
                      任务 {ts.filter((t) => t.status === "Done").length}/
                      {ts.length} ·{" "}
                      {ts.length
                        ? Math.round(
                            (ts.filter((t) => t.status === "Done").length /
                              ts.length) *
                              100,
                          )
                        : 0}
                      %
                    </h4>
                    {ts.map((t) => (
                      <button className="row" key={t.id} onClick={() => T(t)}>
                        {t.title}
                      </button>
                    ))}
                    <button
                      onClick={() =>
                        T({ ...newTask("新任务"), projectId: p.id })
                      }
                    >
                      ＋ 项目任务
                    </button>
                  </article>
                );
              })}
          </div>
        )}
      </main>
      {llmExportOpen && <div className="overlay">
        <form className="modal" role="dialog" aria-modal="true" aria-labelledby="llm-export-title"
          onKeyDown={(e) => { if (e.key === "Escape" && !llmExportBusy) setLlmExportOpen(false); }}
          onSubmit={async (e) => {
            e.preventDefault(); if (llmExportBusy) return; setLlmExportBusy(true);
            try {
              await flushPending();
              const result = buildLLMFiles(useAtlas.getState().w, { projectId: llmScope || undefined, format: llmFormat });
              const file = result.files[0];
              const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType + ";charset=utf-8" }));
              const a = document.createElement("a"); a.href = url; a.download = file.name;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setLlmExportOpen(false);
            } catch (error) { alert("导出失败：" + String(error)); }
            finally { setLlmExportBusy(false); }
          }}>
          <h3 id="llm-export-title">导出给 LLM 读取</h3>
          <p>包含项目、导图、任务、状态、执行分工和显式依赖。选择项目可减少无关内容。</p>
          <label>导出范围<select value={llmScope} onChange={(e) => setLlmScope(e.target.value)}>
            <option value="">整个工作区</option>
            {w.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>文件格式<select value={llmFormat} onChange={(e) => setLlmFormat(e.target.value as "markdown" | "json")}>
            <option value="markdown">Markdown（便于阅读）</option><option value="json">JSON（结构化数据）</option>
          </select></label>
          <small>导出是当前内容的快照；缺失或循环依赖会在文件内标注。</small>
          <div className="toolbar"><button type="submit" disabled={llmExportBusy}>{llmExportBusy ? "正在生成…" : "生成文件"}</button>
            <button type="button" disabled={llmExportBusy} onClick={() => setLlmExportOpen(false)}>取消</button></div>
        </form>
      </div>}
      {mapDraft && (
        <div className="overlay">
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="map-dialog-title"
            onKeyDown={(e) => { if (e.key === "Escape") setMapDraft(null); }}
            onSubmit={(e) => {
              e.preventDefault();
              const name = mapDraft.name.trim();
              if (!name) return;
              const current = useAtlas.getState().w;
              const id = mapDraft.id || uid();
              set({ ...current, maps: mapDraft.id
                ? current.maps.map((m) => m.id === id ? { ...m, name } : m)
                : [...current.maps, { id, name }] });
              setMapId(id); selectIds([]); selectEdges([]); setMapDraft(null);
            }}>
            <h3 id="map-dialog-title">{mapDraft.id ? "重命名导图" : "新建思维导图"}</h3>
            <label>导图名称<input autoFocus required value={mapDraft.name} onChange={(e) => setMapDraft({ ...mapDraft, name: e.target.value })} /></label>
            <div className="toolbar">
              <button type="submit" disabled={!mapDraft.name.trim()}>保存导图</button>
              <button type="button" onClick={() => setMapDraft(null)}>取消</button>
            </div>
          </form>
        </div>
      )}
      {projectName !== null && (
        <div className="overlay">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setProjectName(null);
            }}
            onSubmit={(e) => {
              e.preventDefault();
              const name = projectName.trim();
              if (!name) return;
              const created = {
                id: uid(),
                name,
                description: "",
                status: "进行中",
                priority: "中",
                createdAt: new Date().toISOString(),
                due: "",
                url: "",
                nodeIds: [],
              };
              set({ ...w, projects: [...w.projects, created] });
              SP(created.id);
              setProjectName(null);
            }}
          >
            <h3 id="new-project-title">新建项目</h3>
            <label>
              项目名称
              <input
                autoFocus
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </label>
            <div className="toolbar">
              <button type="submit" disabled={!projectName.trim()}>
                创建项目
              </button>
              <button type="button" onClick={() => setProjectName(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}
      {task && (
        <div className="overlay">
          <section className="modal">
            <h3>任务详情</h3>
            <label>
              标题
              <input
                value={task.title}
                onChange={(e) => T({ ...task, title: e.target.value })}
              />
            </label>
            <label>
              描述
              <textarea
                value={task.description}
                onChange={(e) => T({ ...task, description: e.target.value })}
              />
            </label>
            <div className="grid">
              {(
                ["status", "type", "priority", "projectId", "sprintId"] as const
              ).map((key) => (
                <label key={key}>
                  {
                    {
                      status: "状态",
                      type: "类型",
                      priority: "优先级",
                      projectId: "项目",
                      sprintId: "Sprint",
                    }[key]
                  }
                  <select
                    value={task[key]}
                    onChange={(e) => T({ ...task, [key]: e.target.value })}
                  >
                    {(key === "status"
                      ? statuses.map((x) => [x, x])
                      : key === "type"
                        ? ["学习", "开发", "测试", "Bug", "研究"].map((x) => [
                            x,
                            x,
                          ])
                        : key === "priority"
                          ? ["高", "中", "低"].map((x) => [x, x])
                          : key === "projectId"
                            ? [
                                ["", "无项目"],
                                ...w.projects.map((p) => [p.id, p.name]),
                              ]
                            : [
                                ["", "无 Sprint"],
                                ...w.sprints.map((s) => [s.id, s.name]),
                              ]
                    ).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              截止日期
              <input
                type="date"
                value={task.due}
                onChange={(e) => T({ ...task, due: e.target.value })}
              />
            </label>
            <label>
              估计工作量
              <input
                type="number"
                min="0"
                value={task.estimate}
                onChange={(e) =>
                  T({ ...task, estimate: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label>
              个人标记颜色（不影响类型配色）
              <input
                type="color"
                value={task.color}
                onChange={(e) => T({ ...task, color: e.target.value })}
              />
            </label>
            <h4>绑定技术节点</h4>
            <input
              placeholder="搜索已有节点"
              value={search}
              onChange={(e) => Q(e.target.value)}
            />
            <div className="node-list">
              {w.nodes
                .filter((n) =>
                  n.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((n) => (
                  <label className="check" key={n.id}>
                    <input
                      type="checkbox"
                      checked={task.nodeIds.includes(n.id)}
                      onChange={(e) =>
                        T({
                          ...task,
                          nodeIds: e.target.checked
                            ? [...task.nodeIds, n.id]
                            : task.nodeIds.filter((id) => id !== n.id),
                        })
                      }
                    />
                    {n.title}
                    <button
                      onClick={() => {
                        T(null);
                        navigate(n.id);
                      }}
                    >
                      定位
                    </button>
                  </label>
                ))}
            </div>
            <small>
              创建 {task.createdAt.slice(0, 10)} · 修改{" "}
              {task.updatedAt.slice(0, 10)}
            </small>
            <div className="toolbar">
              <button
                onClick={() => {
                  if (!task.title.trim()) return;
                  const saved = {
                    ...task,
                    updatedAt: new Date().toISOString(),
                  };
                  set({
                    ...w,
                    tasks: w.tasks.some((t) => t.id === task.id)
                      ? w.tasks.map((t) => (t.id === task.id ? saved : t))
                      : [...w.tasks, saved],
                  });
                  T(null);
                }}
              >
                保存任务
              </button>
              <button onClick={() => T(null)}>取消</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("删除任务？")) {
                    set({
                      ...w,
                      tasks: w.tasks.filter((t) => t.id !== task.id),
                    });
                    T(null);
                  }
                }}
              >
                删除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Column({
  status,
  tasks,
  edit,
}: {
  status: Task["status"];
  tasks: Task[];
  edit: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { kind: "column", status } });
  const { over } = useDndContext();
  const highlighted = isOver || over?.data.current?.status === status;
  return (
    <section ref={setNodeRef} aria-label={`${status} 分区`} className={"column " + (highlighted ? "over" : "")}>
      <h3>
        {status} <small>{tasks.length}</small>
      </h3>
      {tasks.map((t) => (
        <Card key={t.id} task={t} edit={edit} />
      ))}
      <p className="column-drop-hint">{tasks.length ? "拖到本分区任意位置可移入" : "拖动任务到此分区"}</p>
    </section>
  );
}
function Card({ task, edit }: { task: Task; edit: (t: Task) => void }) {
  const typeColor = taskTypeColor(task.type);
  const drag = useDraggable({ id: task.id });
  const drop = useDroppable({ id: task.id, data: { kind: "task", status: task.status } });
  return (
    <article
      className="task-card"
      data-task-type={task.type}
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      style={{
        borderTop: `4px solid ${typeColor}`,
        borderLeft: `3px solid ${typeColor}`,
        background: `linear-gradient(${typeColor}1f, ${typeColor}1f), var(--bg)`,
        transform: drag.transform
          ? `translate(${drag.transform.x}px,${drag.transform.y}px)`
          : undefined,
        opacity: drag.isDragging ? 0.6 : 1,
        zIndex: drag.isDragging ? 20 : 1,
      }}
    >
      <button className="handle" {...drag.listeners} {...drag.attributes}>
        ⠿ 拖动排序
      </button>
      <button className="card-title" onClick={() => edit(task)}>
        {task.title}
      </button>
      <div className="task-meta">
        <span className="task-type-badge" style={{ backgroundColor: typeColor + "24", borderColor: typeColor + "88" }}>
          <span className="task-color-dot" style={{ backgroundColor: typeColor }} />{task.type}
        </span>
        <small>{task.priority}优先级 · {task.estimate} 点</small>
        <span className="task-personal-marker" title={`个人标记：${task.color}`} aria-label="个人标记" style={{ backgroundColor: task.color }} />
      </div>
      <p>
        {task.nodeIds.length} 个关联节点 {task.due && `· ${task.due}`}
      </p>
    </article>
  );
}
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ReactFlowProvider>
        <App />
      </ReactFlowProvider>
    </React.StrictMode>,
  );
  void initialize();
}
