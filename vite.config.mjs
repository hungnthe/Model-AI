import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function analysisApi() {
  let activeJobs = 0;
  function middleware(req, res, next) {
    const route = req.url?.split('?')[0];
    const script = route === '/api/analyze' ? 'analyze.py' : route === '/api/isolation-forest' ? 'isolation_forest.py' : null;
    if (!script) return next();
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end();
    }
    if (activeJobs >= 2) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Đang xử lý dữ liệu. Vui lòng thử lại sau.' }));
    }
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        if (!res.writableEnded) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dữ liệu phân tích vượt quá 2 MB.' }));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      if (activeJobs >= 2) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Đang xử lý dữ liệu. Vui lòng thử lại sau.' }));
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'JSON không hợp lệ.' }));
      }
      const python = process.env.RCF_PYTHON || (existsSync(localPython) ? localPython : 'python');
      const child = spawn(python, ['-u', path.join(root, 'server', script)], {
        cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      activeJobs += 1;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
      let diagnostic = '';
      let finished = false;
      const finish = (message) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        activeJobs -= 1;
        if (!res.destroyed) {
          if (message) res.write(JSON.stringify({ type: 'error', message }) + '\n');
          res.end();
        }
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish('Quá thời gian xử lý 90 giây. Hãy giảm số cây hoặc số bản ghi.');
      }, 90000);
      child.stdout.on('data', (chunk) => { if (!res.destroyed) res.write(chunk); });
      child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
      child.stdin.on('error', () => {});
      child.on('error', () => finish('Không khởi chạy được Python. Cần cài requirements.txt trong .venv.'));
      child.on('close', (code) => {
        if (code && diagnostic.includes('ModuleNotFoundError')) {
          finish('Thiếu thư viện Python. Cài requirements.txt trong .venv rồi chạy lại.');
        } else if (code && diagnostic.includes('Traceback')) {
          console.error(diagnostic);
          finish('Không xử lý được dữ liệu này. Kiểm tra các trường số và thử lại.');
        } else finish();
      });
      res.on('close', () => { if (!finished) child.kill(); });
      child.stdin.end(JSON.stringify(payload));
    });
  }
  return {
    name: 'rcf-analysis-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [analysisApi()],
  build: {
    rollupOptions: {
      input: {
        home: path.join(root, 'index.html'),
        rcf: path.join(root, 'rcf.html'),
        isolationForest: path.join(root, 'isolation-forest.html'),
      },
    },
  },
  server: { watch: { ignored: ['**/.venv/**', '**/test-artifacts/**'] } },
});
