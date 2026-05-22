const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');

const PORT = process.env.PORT || 5000;
const BASE_DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function runGenerator(script, stateJson, callback) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  execFile(process.execPath, [script, stateJson, tmpDir], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) { callback(new Error(stderr || err.message), null, tmpDir); return; }
    const files = stdout.trim().split('\n').map(f => f.trim()).filter(f => f && fs.existsSync(f));
    callback(null, files, tmpDir);
  });
}

function sendFile(res, filePath, tmpDir) {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
    'Content-Length': data.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
  if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
}

function sendError(res, msg, tmpDir) {
  console.error('[HIBA]', msg);
  res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(String(msg).slice(0, 300));
  if (tmpDir) try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'POST' && req.url === '/generate-docs') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch(e) { res.writeHead(400); res.end('Bad JSON'); return; }

      const docType = data.type || 'both';
      const stateJson = JSON.stringify(data.state || {});

      const scripts = {
        report:  'generate-report.js',
        alapdok: 'generate-alapdok.js',
        avk:     'generate-docs.js',
        hurok:   'generate-docs.js',
        both:    'generate-docs.js',
      };
      const scriptFile = path.join(BASE_DIR, scripts[docType] || 'generate-docs.js');

      runGenerator(scriptFile, stateJson, (err, files, tmpDir) => {
        if (err) { sendError(res, err.message, tmpDir); return; }
        if (!files || !files.length) { sendError(res, 'Nincs output fájl', tmpDir); return; }

        if (docType === 'report' || docType === 'alapdok' || docType === 'hurok' || docType === 'avk') {
          // Egyfájlos: típus alapján szűrjük
          let target = files[0];
          if (docType === 'avk') target = files.find(f => f.toUpperCase().includes('AVK')) || files[0];
          if (docType === 'hurok') target = files.find(f => f.toUpperCase().includes('HUROK')) || files[0];
          sendFile(res, target, tmpDir);
          return;
        }

        // both → ZIP a beépített zlib-bel, archiver nélkül
        // Egyszerűen: küldjük vissza JSON-ban a fájlok base64 tartalmát
        // Az app.js majd letölti mindkettőt
        const result = files.map(f => ({
          name: path.basename(f),
          data: fs.readFileSync(f).toString('base64'),
        }));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ files: result }));
      });
    });
    return;
  }

  // Static
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(BASE_DIR, urlPath);
  if (!filePath.startsWith(BASE_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveStatic(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SMARTGuard fut: http://0.0.0.0:${PORT}`);
});
