const { execFile } = require('child_process');
const path = require('path');

const stateJson = process.argv[2];
const outDir = process.argv[3] || '.';
if (!stateJson) { process.stderr.write("Nincs state!\n"); process.exit(1); }

const state = JSON.parse(stateJson);
state._docType = 'alapdok';

execFile('python3', [
  path.join(__dirname, 'fill_templates.py'),
  JSON.stringify(state),
  outDir
], { timeout: 30000 }, (err, stdout, stderr) => {
  if (err) { process.stderr.write(stderr || err.message); process.exit(1); }
  process.stdout.write(stdout);
});
