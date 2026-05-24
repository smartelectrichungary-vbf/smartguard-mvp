#!/usr/bin/env python3
"""SMARTGuard VBF – Python HTTP szerver"""
import http.server, json, os, subprocess, tempfile, base64, sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 5000))

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.webmanifest': 'application/manifest+json',
}

def find_python():
    import shutil
    return shutil.which('python3') or shutil.which('python') or 'python'

PYTHON = find_python()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {args[0]} {args[1]}", flush=True)

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/': path = '/index.html'
        file_path = os.path.normpath(os.path.join(BASE_DIR, path.lstrip('/')))
        if not file_path.startswith(BASE_DIR):
            self.send_error(403); return
        if os.path.isfile(file_path):
            ext = os.path.splitext(file_path)[1]
            ct = MIME.get(ext, 'text/plain')
            with open(file_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', ct)
            self.send_header('Content-Length', len(data))
            self.send_header('Cache-Control', 'no-store')
            self.send_cors()
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != '/generate-docs':
            self.send_error(404); return

        try:
            length = int(self.headers.get('Content-Length', 0))
            raw = self.rfile.read(length)
            body = json.loads(raw.decode('utf-8', errors='replace'))
        except Exception as e:
            self.send_response(400)
            self.send_cors()
            self.end_headers()
            self.wfile.write(f'JSON parse hiba: {e}'.encode('utf-8'))
            return

        doc_type = body.get('type', 'both')
        state    = body.get('state', {})
        state['_docType'] = doc_type

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                script = os.path.join(BASE_DIR, 'fill_templates.py')

                # State-t fájlba írjuk (command line hossz limit elkerülése)
                state_file = os.path.join(tmpdir, '_state.json')
                with open(state_file, 'w', encoding='utf-8') as sf:
                    json.dump(state, sf, ensure_ascii=False)

                result = subprocess.run(
                    [PYTHON, script, state_file, tmpdir],
                    capture_output=True,
                    timeout=60,
                    env=dict(os.environ, PYTHONIOENCODING='utf-8')
                )

                stdout = result.stdout.decode('utf-8', errors='replace')
                stderr = result.stderr.decode('utf-8', errors='replace')

                if result.returncode != 0:
                    err = stderr[:600] or 'Ismeretlen hiba'
                    print(f"[HIBA] {err}", flush=True)
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/plain; charset=utf-8')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(err.encode('utf-8', errors='replace'))
                    return

                files = [f.strip() for f in stdout.strip().split('\n')
                         if f.strip() and os.path.exists(f.strip())]

                if not files:
                    # Nincs output fájl - hibaüzenet küldése
                    msg = f'Nincs output fajl. stdout={stdout!r} stderr={stderr[:200]!r}'
                    print(f"[HIBA] {msg}", flush=True)
                    self.send_response(500)
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(msg.encode('utf-8', errors='replace'))
                    return

                if doc_type == 'alapdok':
                    with open(files[0], 'rb') as f: data = f.read()
                    fname = os.path.basename(files[0])
                    self.send_response(200)
                    self.send_header('Content-Type', MIME['.docx'])
                    self.send_header('Content-Disposition', f'attachment; filename="{fname}"')
                    self.send_header('Content-Length', len(data))
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(data)

                elif doc_type in ('avk', 'hurok'):
                    target = next(
                        (f for f in files if doc_type.upper() in os.path.basename(f).upper()),
                        files[0]
                    )
                    with open(target, 'rb') as f: data = f.read()
                    fname = os.path.basename(target)
                    self.send_response(200)
                    self.send_header('Content-Type', MIME['.docx'])
                    self.send_header('Content-Disposition', f'attachment; filename="{fname}"')
                    self.send_header('Content-Length', len(data))
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(data)

                else:
                    # both → base64 JSON
                    result_files = []
                    for fp in files:
                        with open(fp, 'rb') as f:
                            result_files.append({
                                'name': os.path.basename(fp),
                                'data': base64.b64encode(f.read()).decode('ascii')
                            })
                    resp = json.dumps({'files': result_files}).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(resp))
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(resp)

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            print(f"[SZERVER HIBA]\n{tb}", flush=True)
            try:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_cors()
                self.end_headers()
                self.wfile.write(tb.encode('utf-8', errors='replace'))
            except:
                pass


if __name__ == '__main__':
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
    except:
        ip = '192.168.x.x'

    print(f"\n{'='*50}")
    print(f"  SMARTGuard szerver elindult!")
    print(f"  PC:      http://127.0.0.1:{PORT}")
    print(f"  Telefon: http://{ip}:{PORT}")
    print(f"  Leallitas: Ctrl+C")
    print(f"{'='*50}\n", flush=True)

    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nSzerver leallitva.')
