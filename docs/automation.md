# 本机操作接口

程序必须保持运行。API 仅监听 127.0.0.1；每次启动使用动态端口和新凭据。当前用户数据目录中的 automation.json 用于本机客户端发现服务。不要上传该文件，也不要把 token 填进模型提示词。CLI 会在本机读取凭据，不输出 token。

## 命令行

使用 Node.js 22 或更新版本：

```powershell
node scripts/devatlas-cli.cjs health
node scripts/devatlas-cli.cjs tools
node scripts/devatlas-cli.cjs workspace
node scripts/devatlas-cli.cjs call maps_create --args-file arguments.json --dry-run
node scripts/devatlas-cli.cjs call maps_create --args-file arguments.json
```

arguments.json 示例：`{"name":"Python 学习路线"}`。文件应为 UTF-8 JSON，内容仅包含工具参数，不包含 tool、凭据或版本。命令行写操作自动读取最新工作区版本及生成 requestId。测试实例可用 `--user-data` 指定其配置目录。

## 导出给 LLM 读取

DevAtlas 0.4.0 提供 `workspace_export_llm` 只读工具；参数为可选 projectId，以及 format: markdown/json/both。结果中 files 含文件名、MIME 类型和内容，调用方决定保存位置。

CLI 可直接保存同一快照的两个文件：

```powershell
node scripts/devatlas-cli.cjs export --project-id p1 --output-dir "D:\Codex Work\exports"
```

省略 --project-id 时导出整个工作区。CLI 不覆盖同名文件，不输出文件全部内容或本机接口凭据，只返回文件路径、版本和摘要。软件侧栏也可选择范围和格式下载单个文件。

导出保留描述原文，并解析“依赖任务 ID：”“开发依赖任务 ID：”下的 `编号 → 任务ID` 行。自然语言依赖不会被自动猜测。按项目导出只包含项目明确关联的节点和任务、任务的传递依赖及必要项目/导图/Sprint；跨项目的前置任务会标为 externalDependency。出现缺失或循环会标注，不会伪装成已满足。JSON 的 format 为 devatlas.llm-context，不是 workspace 备份格式，不可用“导入 JSON”直接覆盖工作区。

模型可通过其中的项目说明、节点和任务 sections 读取玩家设定、剧情事件、验收和分工。内容是导出时的快照；后续写入仍需查询实时工作区及 revision，不应按标题或导出数据覆盖整个工作区。

调用另一个工具时，用上一步正式提交返回的 ID。例如先 maps_create，再 nodes_create（mapId、title、可选 parentId），再 tasks_create（title、可选 nodeIds、projectId、sprintId 和 status）。工具完整参数见 tools 返回的 inputSchema。

## HTTP

所有端点都需要 Authorization: Bearer 凭据。不设置 CORS，拒绝带 Origin 的请求和非本机 Host。不要把服务转发到其他设备。

| 方法 | 路径 | 结果 |
| --- | --- | --- |
| GET | /v1/health | 服务健康状态 |
| GET | /v1/tools | 工具名称、说明、mutates 和 JSON Schema |
| GET | /v1/workspace | workspace 与 revision；先刷新界面待保存编辑 |
| POST | /v1/call | 执行一个工具操作 |

POST 请求必须是 application/json，最大 1 MiB；格式示例：

```json
{
  "tool": "maps_create",
  "arguments": { "name": "Python 学习路线" },
  "expectedRevision": "先读取工作区取得的版本字符串",
  "requestId": "本次写操作的唯一编号",
  "dryRun": false
}
```

只读工具不需要 expectedRevision、requestId。写操作要求两者，删除操作的工具参数还要求 confirm: true。结果包含 ok、result、revision 和 dryRun。错误包含 error.code 与 message；409 表示版本冲突或请求编号冲突，应重新读取并判断操作是否仍适用，不要改成无版本强制写入。

dryRun 校验并计算结果，不落盘、不通知界面。预演中的新 ID 不保留；实际提交时使用新 requestId，后续关联使用实际提交返回的 ID。同一进程内相同写请求的幂等缓存为 5 分钟、最多 200 条；重试必须同时保留原 requestId、expectedRevision、工具及参数。应用重启后缓存不保留。

## 工具范围

- workspace_get：完整工作区。
- maps_list/create/update/delete：导图操作；最后一张导图不能删除。
- nodes_list/create/update/delete/copy/move：节点及批量操作；创建支持 parentId 自动连接。
- edges_list/create/delete：同图连线，重复同关系连线返回已有 ID。
- tasks_list/create/update/move/delete：任务操作、节点绑定、看板状态与排序。
- projects_list/create/update：项目及其节点绑定。
- sprints_list/create/update：Sprint 及日期。

复制节点保留内部连线，创建独立 ID，不复制任务绑定。移动节点保留 ID 和任务、项目关联，跨图边界连线会断开。删除节点清理引用，保留任务与项目。工具操作提交前重新验证完整工作区，禁止悬空 ID 和跨图连线。

## 与界面共同编辑

接口读写会先等待界面把待保存编辑提交到共同的写入队列。界面保存也带版本检查。接口成功提交后，界面接收新工作区，不需要重启。若用户恰好在同步期间继续输入，界面会保留本地编辑并显示冲突；此时可先“导出 JSON”，再“重新读取工作区”。冲突解决前接口不会继续写入。

程序正常退出时会刷新待保存编辑、关闭服务并删除发现文件。异常退出可能留下旧发现文件，客户端连接失败后应重新启动程序。当前不包含外部模型配置或自动注册 MCP；LLM 可通过命令行或 HTTP 调用本接口。
