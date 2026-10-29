#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
async function run(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') flags.dryRun = true;
    else if (['--user-data', '--args-file', '--revision', '--request-id', '--project-id', '--output-dir'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`缺少 ${arg} 的值`);
      flags[arg] = argv[++i];
    } else if (arg.startsWith('--')) throw Error(`未知参数 ${arg}`);
    else positional.push(arg);
  }
  const [command, tool] = positional;
  if (!command || command === 'help') return {
    usage: ['devatlas-cli.cjs health', 'devatlas-cli.cjs tools', 'devatlas-cli.cjs workspace',
      'devatlas-cli.cjs call TOOL --args-file arguments.json [--dry-run] [--revision REV] [--request-id ID]',
      'devatlas-cli.cjs export --output-dir DIRECTORY [--project-id ID]'],
    userData: '默认 %APPDATA%/devatlas，可用 --user-data 指定测试配置',
  };
  if (!['health', 'tools', 'workspace', 'call', 'export'].includes(command)) throw Error('未知命令');
  const userData = flags['--user-data'] || process.env.DEVATLAS_USER_DATA || path.join(process.env.APPDATA || '', 'devatlas');
  let discovery;
  try { discovery = JSON.parse(await fs.readFile(path.join(userData, 'automation.json'), 'utf8')); }
  catch { throw Error('找不到本机接口配置，请先启动 DevAtlas 0.3.0 或更新版本'); }
  if (discovery.host !== '127.0.0.1' || !Number.isInteger(discovery.port) || discovery.port < 1 || discovery.port > 65535 ||
      discovery.apiVersion !== 1 || typeof discovery.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(discovery.token)) throw Error('本机接口配置无效');
  function request(method, url, data) {
    return new Promise((resolve, reject) => {
      const payload = data === undefined ? null : JSON.stringify(data);
      const req = http.request({ hostname: '127.0.0.1', port: discovery.port, method, path: url,
        headers: { Authorization: `Bearer ${discovery.token}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
        const chunks = []; let size = 0;
        res.on('data', (chunk) => { size += chunk.length; if (size > 25000000) { res.destroy(); reject(Error('接口响应过大')); } else chunks.push(chunk); });
        res.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (res.statusCode >= 400) { const e = Error(value.error?.message || '接口调用失败'); e.code = value.error?.code; reject(e); }
            else resolve(value);
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.setTimeout(12000, () => req.destroy(Error('接口调用超时，请确认程序界面已就绪')));
      req.on('error', (error) => reject(Error(error.code === 'ECONNREFUSED' ? 'DevAtlas 接口未运行，请重新启动软件' : error.message)));
      req.end(payload);
    });
  }
  if (command === 'export') {
    if (!flags['--output-dir']) throw Error('export 必须指定 --output-dir');
    const args = { format: 'both', ...(flags['--project-id'] ? { projectId: flags['--project-id'] } : {}) };
    const response = await request('POST', '/v1/call', { tool: 'workspace_export_llm', arguments: args });
    const directory = path.resolve(flags['--output-dir']);
    await fs.mkdir(directory, { recursive: true });
    const files = [];
    for (const file of response.result.files) {
      if (path.basename(file.name) !== file.name || /[\\/]/.test(file.name)) throw Error('导出文件名无效');
      const target = path.join(directory, file.name);
      await fs.writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' });
      files.push({ path: target, mimeType: file.mimeType, bytes: Buffer.byteLength(file.content) });
    }
    return { ok: true, exportId: response.result.exportId, revision: response.revision, scope: response.result.scope, summary: response.result.summary, warnings: response.result.warnings, files };
  }
  if (command !== 'call') return request('GET', `/v1/${command === 'workspace' ? 'workspace' : command}`);
  if (!tool) throw Error('缺少操作名称');
  let args = {};
  if (flags['--args-file']) args = JSON.parse(await fs.readFile(flags['--args-file'], 'utf8'));
  const definitions = await request('GET', '/v1/tools');
  const definition = definitions.tools.find((x) => x.name === tool);
  if (!definition) throw Error('未知操作，请先使用 tools 查看');
  const body = { tool, arguments: args, dryRun: !!flags.dryRun };
  if (definition.mutates) {
    body.expectedRevision = flags['--revision'] || (await request('GET', '/v1/workspace')).revision;
    body.requestId = flags['--request-id'] || randomUUID();
  }
  const result = await request('POST', '/v1/call', body);
  return { ...result, ...(definition.mutates ? { requestId: body.requestId, expectedRevision: body.expectedRevision } : {}) };
}
module.exports = { run };
if (require.main === module) run(process.argv.slice(2)).then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: { code: error.code || 'CLIENT_ERROR', message: error.message } }) + '\n');
  process.exitCode = 1;
});
