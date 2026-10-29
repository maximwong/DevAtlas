# 架构
Electron 主进程负责 userData 下 workspace.json；preload 只暴露 read、save、backup 三个固定方法。React 不访问文件系统，不执行命令。主进程阻止外部导航和新窗口。

schemaVersion=1：nodes、edges、tasks、projects、sprints 使用稳定 UUID（初始演示 ID 固定）。任务 nodeIds 是多对多关系唯一来源，节点进度实时通过 tasks.filter 计算，空集合为 0%。项目任务通过 projectId 查询，项目技术通过 nodeIds 引用。Sprint 使用 sprintId。删除节点清理任务、项目与连线中的引用，任务保留。数组顺序保存看板排序；拖拽目标卡片作为插入位置。

Zustand 提供内存状态；250ms 防抖后顺序保存。先写临时文件并 fsync，备份旧文件，再 rename；保留最近一次有效文件。读取失败不自动覆盖，用户可以导入或恢复备份。导入使用 Zod 校验版本、字段、重复 ID 和引用完整性。尚不支持旧版本迁移。浏览器预览使用 localStorage，桌面版使用文件。

自由布局保存每个节点坐标；树布局采用入度拓扑层级，环路节点回到第一层。React Flow 提供端口连线、缩放、平移、小地图。dnd-kit 提供跨列移动和同列插入。
