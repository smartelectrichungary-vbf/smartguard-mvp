const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;
const BASE_DIR = __dirname;

// Static fájlok kiszolgálása - minden CSS, JS, HTML
app.use(express.static(BASE_DIR, {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

app.use(express.json({ limit: '10mb' }));

function runGenerator(script, stateJson, callback) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  execFile(process.execPath, [script, stateJson, tmpDir], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) { callback(new Error(stderr || err.message), null, tmpDir); return; }
    const files = stdout.trim().split('\n').map(f => f.trim()).filter(f => f && fs.existsSync(f));
    callback(null, files, tmpDir);
  });
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch(e) {}
}

app.post('/generate-docs', (req, res) => {
  const docType = req.body.type || 'both';
  const stateJson = JSON.stringify(req.body.state || {});

  const scripts = {
    report:  'generate-report.js',
    alapdok: 'generate-alapdok.js',
    avk:     'generate-docs.js',
    hurok:   'generate-docs.js',
    both:    'generate-docs.js',
  };
  const scriptFile = path.join(BASE_DIR, scripts[docType] || 'generate-docs.js');

  runGenerator(scriptFile, stateJson, (err, files, tmpDir) => {
    if (err) {
      cleanup(tmpDir);
      console.error('[HIBA]', err.message);
      return res.status(500).send('Generálás sikertelen: ' + err.message.slice(0, 200));
    }
    if (!files || !files.length) {
      cleanup(tmpDir);
      return res.status(500).send('Nincs output fájl');
    }

    // Egyfájlos válasz
    if (docType === 'report' || docType === 'alapdok') {
      const file = files[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
      res.sendFile(file, err => { cleanup(tmpDir); });
      return;
    }

    if (docType === 'avk' || docType === 'hurok') {
      const file = files.find(f => f.toUpperCase().includes(docType.toUpperCase())) || files[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
      res.sendFile(file, err => { cleanup(tmpDir); });
      return;
    }

    // both → JSON-ban base64
    const result = files.map(f => ({
      name: path.basename(f),
      data: fs.readFileSync(f).toString('base64'),
    }));
    cleanup(tmpDir);
    res.json({ files: result });
  });
});

// SPA fallback - minden egyéb kérés az index.html-t adja vissza
app.get('*', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SMARTGuard fut: http://0.0.0.0:${PORT}`);
});
