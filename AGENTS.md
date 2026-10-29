# DevAtlas 工程规范
使用 TypeScript strict。渲染进程禁止 Node 和任意 IPC；Electron 使用 contextIsolation、sandbox。节点与任务以稳定 ID 关联，禁止复制数据作为关联。修改 schema 时提供迁移策略；导入必须验证，不覆盖损坏的原文件。禁止提交用户数据和凭证。
提交前执行 npm run typecheck、npm test、npm run build。Windows 安装包必须在 windows-latest 上验证。每个稳定阶段做有意义的提交，禁止强推或改写无关历史。界面中文优先，真实功能优先于动画。不虚构测试和发布结果。
