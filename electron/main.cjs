const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const storage = require('./storage.cjs');
const { createRepository, startAutomation, ApiError } = require('./automation.cjs');
let win, automation, rendererReady = false, closing = false;
const pending = new Map();
async function flushRenderer() {
  if (!win || win.isDestroyed() || !rendererReady) throw new ApiError(503, 'UI_BUSY', '界面尚未就绪，请稍后重试');
  const id = randomUUID();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new ApiError(409, 'UI_BUSY', '等待界面保存超时，本次操作未执行')); }, 7000);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('workspace:flush', id);
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const userData = app.getPath('userData');
    const file = path.join(userData, 'workspace.json');
    const repository = createRepository({ file, flush: flushRenderer, notify: (snapshot) => {
      if (win && !win.isDestroyed()) win.webContents.send('workspace:changed', snapshot);
    } });
    ipcMain.handle('workspace:read', () => storage.read(file));
    ipcMain.handle('workspace:backup', () => storage.read(file + '.bak'));
    ipcMain.handle('workspace:snapshot', () => repository.snapshot());
    ipcMain.handle('workspace:commit', (_, data, revision) => repository.commit(data, revision));
    ipcMain.handle('workspace:save', () => { throw Error('请使用带版本检查的保存接口'); });
    ipcMain.handle('workspace:ready', (event) => {
      if (event.sender === win?.webContents) rendererReady = true;
    });
    ipcMain.on('workspace:flushed', (event, id, error) => {
      if (event.sender !== win?.webContents) return;
      const request = pending.get(id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(id);
      if (error) request.reject(new ApiError(409, 'UI_CONFLICT', '界面有未保存或冲突的编辑，请先处理'));
      else request.resolve();
    });
    try { automation = await startAutomation({ repository, userData }); }
    catch (error) { console.error('DevAtlas local API could not start:', error.message); }
    win = new BrowserWindow({ width: 1440, height: 900, minWidth: 1000, minHeight: 650,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
    win.webContents.on('did-start-loading', () => { rendererReady = false; });
    win.on('close', async (event) => {
      if (closing) return;
      event.preventDefault(); closing = true;
      try {
        if (rendererReady) await flushRenderer();
        if (automation) await automation.close();
        win.destroy(); app.quit();
      } catch {
        closing = false;
        dialog.showErrorBox('尚未退出', '编辑未能保存。请先导出 JSON，或处理界面中的保存冲突后再退出。');
      }
    });
    if (app.isPackaged) await win.loadFile(path.join(__dirname, '../dist/index.html'));
    else await win.loadURL('http://127.0.0.1:5173');
  });
  app.on('window-all-closed', () => app.quit());
}
