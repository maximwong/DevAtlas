# 验证记录（2026-10-28，Linux / Node 24.19.0）

- `npm run typecheck`：通过。
- `npm test`：3 个测试文件，11 项通过，0 失败。
- `npm run build`：通过，生成 dist；存在主包超过 500kB 的体积警告。
- 模型测试：演示初始化、创建节点与序列化、任务增改删、跨列移动与排序、多对多关联和空集合进度、节点删除引用清理、导入导出和无效结构拒绝、Sprint 分配。
- 文件测试：临时目录下真实写入、重读、最近备份。
- React Testing Library：操作任务详情，绑定 Python，设置 Done 并检查 Dashboard；确认删除任务并保留节点。

未验证：真实鼠标拖拽、Electron 桌面 GUI、Windows 安装/卸载、SmartScreen、高 DPI。拖拽底层状态操作已测试，但不能等同端到端拖拽验收。没有可用浏览器工具，未生成真实截图。

GitHub CLI 存在，但 `gh auth status` 报告当前 GH_TOKEN 无效；未配置远端，未创建仓库或推送，无 PR、Actions 运行或 EXE 下载地址。Windows workflow 已配置但未执行。Electron Linux 二进制下载在安装时跳过；本地只验证前端生产构建，不代表 Electron 打包成功。恢复 GitHub 有效授权后可创建私有 devatlas 仓库并推送 main，再查看 Windows workflow 产物。
