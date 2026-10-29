const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const storage = require('./storage.cjs');
const operations = require('./operations.cjs');
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createRepository({ file, notify = () => {}, flush = async () => {} }) {
  let state, revision, initialized;
  let queue = Promise.resolve();
  const requests = new Map();
  function serial(fn) {
    const next = queue.catch(() => {}).then(fn);
    queue = next.catch(() => {});
    return next;
  }
  async function load() {
    if (!initialized) initialized = (async () => {
      const raw = await storage.read(file);
      state = raw ? operations.parseWorkspace(raw) : operations.demo();
      if (!raw) await storage.save(file, state);
      revision = hash(state);
    })();
    await initialized;
  }
  const snapshotNow = () => ({ workspace: clone(state), revision });
  function checkRevision(expected) {
    if (typeof expected !== 'string' || expected !== revision)
      throw new ApiError(409, 'REVISION_CONFLICT', '工作区已改变，请重新读取后再执行；本次未写入');
  }
  async function persist(data, publish) {
    const nextRevision = hash(data);
    if (nextRevision !== revision) {
      await storage.save(file, data);
      state = data; revision = nextRevision;
      if (publish) { try { notify(snapshotNow()); } catch {} }
    }
    return snapshotNow();
  }
  return {
    snapshot: () => serial(async () => { await load(); return snapshotNow(); }),
    commit: (data, expected) => serial(async () => {
      await load(); checkRevision(expected);
      if (JSON.stringify(data).length > 20000000) throw new ApiError(413, 'TOO_LARGE', '工作区过大');
      return persist(operations.parseWorkspace(data), false);
    }),
    async call(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some((k) => !['tool', 'arguments', 'expectedRevision', 'requestId', 'dryRun'].includes(k)) ||
          typeof body.tool !== 'string' || (body.dryRun !== undefined && typeof body.dryRun !== 'boolean'))
        throw new ApiError(400, 'INVALID_REQUEST', '调用格式无效');
      const write = operations.isWriteTool(body.tool);
      if (write && (typeof body.requestId !== 'string' || !body.requestId.length || body.requestId.length > 128))
        throw new ApiError(400, 'REQUEST_ID_REQUIRED', '写操作必须提供唯一 requestId');
      if (write && typeof body.expectedRevision !== 'string') throw new ApiError(400, 'REVISION_REQUIRED', '写操作必须提供 expectedRevision');
      const fingerprint = hash(body);
      const cached = () => {
        const item = requests.get(body.requestId);
        if (!item || item.expires < Date.now()) return null;
        if (item.fingerprint !== fingerprint) throw new ApiError(409, 'REQUEST_ID_REUSED', 'requestId 已用于不同请求');
        return clone(item.reply);
      };
      if (write) { const reply = cached(); if (reply) return reply; }
      if (!body.dryRun) await flush();
      return serial(async () => {
        await load();
        if (write) { const reply = cached(); if (reply) return reply; checkRevision(body.expectedRevision); }
        const { workspace, result } = operations.executeTool(state, body.tool, body.arguments ?? {});
        if (write && !body.dryRun) await persist(workspace, true);
        const reply = { ok: true, result: clone(result), revision, dryRun: !!body.dryRun };
        if (write) {
          requests.set(body.requestId, { fingerprint, reply: clone(reply), expires: Date.now() + 300000 });
          while (requests.size > 200) requests.delete(requests.keys().next().value);
        }
        return reply;
      });
    },
    flush,
  };
}

async function startAutomation({ repository, userData, port = 0 }) {
  const token = randomBytes(32).toString('base64url');
  const discoveryFile = path.join(userData, 'automation.json');
  let boundPort;
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.origin || ![`127.0.0.1:${boundPort}`, `localhost:${boundPort}`].includes(req.headers.host))
        throw new ApiError(403, 'ORIGIN_DENIED', '不接受浏览器跨站调用或非本机 Host');
      const auth = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new ApiError(401, 'UNAUTHORIZED', '需要本机接口凭据');
      if (req.method === 'GET' && req.url === '/v1/health') return send(200, { ok: true, apiVersion: 1 });
      if (req.method === 'GET' && req.url === '/v1/tools') return send(200, { tools: operations.listTools() });
      if (req.method === 'GET' && req.url === '/v1/workspace') {
        await repository.flush(); return send(200, await repository.snapshot());
      }
      if (req.method !== 'POST' || req.url !== '/v1/call') throw new ApiError(404, 'NOT_FOUND', '接口不存在');
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'JSON_REQUIRED', '请求必须为 JSON');
      const bytes = await new Promise((resolve, reject) => {
        let size = 0; let rejected = false; const chunks = [];
        req.on('data', (chunk) => {
          if (rejected) return;
          size += chunk.length;
          if (size > 1048576) { rejected = true; res.setHeader('Connection', 'close'); reject(new ApiError(413, 'TOO_LARGE', '请求不能超过 1 MiB')); }
          else chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      let body;
      try { body = JSON.parse(bytes.toString('utf8')); }
      catch { throw new ApiError(400, 'INVALID_JSON', 'JSON 格式无效'); }
      send(200, await repository.call(body));
    } catch (error) {
      send(error.status || 400, { ok: false, error: { code: error.code || 'VALIDATION_ERROR', message: String(error.message).slice(0, 3000) } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  boundPort = server.address().port;
  const discovery = { apiVersion: 1, pid: process.pid, host: '127.0.0.1', port: boundPort, token };
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(discoveryFile, JSON.stringify(discovery), { mode: 0o600 });
  return { port: boundPort, discoveryFile, async close() {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
    try {
      const current = JSON.parse(await fs.readFile(discoveryFile, 'utf8'));
      if (current.token === token) await fs.unlink(discoveryFile);
    } catch {}
  } };
}
module.exports = { createRepository, startAutomation, ApiError };
