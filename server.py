#!/usr/bin/env python3
"""
SMARTGuard helyi szerver
- 5000-es porton static fájlokat szolgál ki
- /generate-docs POST végponton Word fájlokat generál
"""
import http.server
import json
import os
import subprocess
import tempfile
import sys
import shutil

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Node.js keresése – Windows és Linux/Mac
def find_node():
    # Explicit Windows helyek
    win_paths = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        os.path.expanduser(r"~\AppData\Roaming\nvm\current\node.exe"),
    ]
    for p in win_paths:
        if os.path.exists(p):
            return p
    # PATH-ból
    found = shutil.which("node") or shutil.which("node.exe")
    if found:
        return found
    return "node"

NODE = find_node()
print(f"[SMARTGuard] Node.js: {NODE}")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        if self.path == "/generate-docs":
            self.handle_generate()
        else:
            self.send_error(404)

    def handle_generate(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            doc_type = data.get("type", "both")
            state = data.get("state", {})

            with tempfile.TemporaryDirectory() as tmpdir:
                # Riport generálás
                if doc_type == "report":
                    script = os.path.join(BASE_DIR, "generate-report.js")
                    result = subprocess.run(
                        [NODE, script, json.dumps(state), tmpdir],
                        capture_output=True, text=True, timeout=30
                    )
                    if result.returncode != 0:
                        err = f"Node hiba: {result.stderr[:300]} | stdout: {result.stdout[:100]}"
                        print(f"[HIBA] {err}")
                        self.send_error(500, err[:400])
                        return
                    filepath = result.stdout.strip().split("\n")[0].strip()
                    if os.path.exists(filepath):
                        with open(filepath, "rb") as f:
                            data_bytes = f.read()
                        self.send_file(data_bytes, os.path.basename(filepath))
                    return

                # Alapdokumentáció generálás
                if doc_type == "alapdok":
                    script = os.path.join(BASE_DIR, "generate-alapdok.js")
                    result = subprocess.run(
                        [NODE, script, json.dumps(state), tmpdir],
                        capture_output=True, text=True, timeout=30
                    )
                    if result.returncode != 0:
                        err = f"Node hiba: {result.stderr[:300]} | stdout: {result.stdout[:100]}"
                        print(f"[HIBA] {err}")
                        self.send_error(500, err[:400])
                        return
                    filepath = result.stdout.strip().split("\n")[0].strip()
                    if os.path.exists(filepath):
                        with open(filepath, "rb") as f:
                            data_bytes = f.read()
                        self.send_file(data_bytes, os.path.basename(filepath))
                    return

                # AVK + Hurok generálás
                script = os.path.join(BASE_DIR, "generate-docs.js")
                result = subprocess.run(
                    [NODE, script, json.dumps(state), tmpdir],
                    capture_output=True, text=True, timeout=30
                )

                if result.returncode != 0:
                    err = f"Node hiba: {result.stderr[:300]} | stdout: {result.stdout[:100]}"
                    print(f"[HIBA] {err}")
                    self.send_error(500, err[:400])
                    return

                files = {}
                for line in result.stdout.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    if os.path.exists(line):
                        name = os.path.basename(line)
                        with open(line, "rb") as f:
                            files[name] = f.read()

                if doc_type in ("avk", "hurok"):
                    key = [k for k in files if doc_type.upper() in k.upper()]
                    if key:
                        self.send_file(files[key[0]], key[0])
                        return

                import zipfile, io
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                    for name, content in files.items():
                        zf.writestr(name, content)
                buf.seek(0)
                zip_data = buf.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", "attachment; filename=smartguard-jkv.zip")
                self.send_header("Content-Length", str(len(zip_data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(zip_data)

        except Exception as e:
            self.send_error(500, str(e)[:200])

    def send_file(self, data, filename):
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        self.send_header("Content-Disposition", f"attachment; filename={filename}")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[SMARTGuard] {self.address_string()} – {format % args}")

if __name__ == "__main__":
    os.chdir(BASE_DIR)
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"SMARTGuard szerver fut: http://127.0.0.1:{PORT}")
    print(f"Telefon: http://192.168.0.102:{PORT}")
    print("Leállítás: Ctrl+C")
    server.serve_forever()
