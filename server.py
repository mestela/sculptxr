import http.server
import socketserver
import os
import mimetypes

PORT = 8080
ROOT_DIR = os.getcwd()

class XRDevHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1" # Enable persistent connections
    def do_GET(self):
        # 1. Root -> index.html
        if self.path == '/' or self.path == '/index.html':
            self.path = '/index.html'
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
        
        normalized_path = self.path.lstrip('/')
        # Handle query strings if any (strip them for file lookup)
        if '?' in normalized_path:
            normalized_path = normalized_path.split('?')[0]
            
        full_path = os.path.abspath(normalized_path)
        
        # Security check
        if not full_path.startswith(ROOT_DIR):
            self.send_error(403)
            return

        # 2. Handle GLSL -> transform to JS module
        # Force check if path ends with .glsl
        if normalized_path.endswith('.glsl'):
            if os.path.exists(full_path):
                self.serve_glsl(full_path)
                return
            else:
                print(f"[404] GLSL not found: {full_path}")
                self.send_error(404)
                return

        # 3. Handle module resolution
        if os.path.exists(full_path) and os.path.isfile(full_path):
             self.serve_file(full_path)
             return

        # Try adding .js
        if not full_path.endswith('.js'):
             full_path_js = full_path + '.js'
             if os.path.exists(full_path_js) and os.path.isfile(full_path_js):
                 self.serve_file(full_path_js)
                 return

        # 4. Fallback for 'resources/' -> 'app/resources/'
        if normalized_path.startswith('resources/'):
             app_res_path = os.path.join(ROOT_DIR, 'app', normalized_path)
             if os.path.exists(app_res_path) and os.path.isfile(app_res_path):
                 self.serve_file(app_res_path)
                 return

        return http.server.SimpleHTTPRequestHandler.do_GET(self)

    def serve_glsl(self, path):
        try:
            with open(path, 'r') as f:
                content = f.read()
                # Escape backticks and backslashes
                content = content.replace('\\', '\\\\').replace('`', '\\`')
                js_module = f"export default `{content}`;"
                encoded = js_module.encode('utf-8')
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(encoded)
        except Exception as e:
            print(f"Error serving GLSL {path}: {e}")
            self.send_error(500)

    def serve_file(self, path):
         try:
             file_size = os.path.getsize(path)
             with open(path, 'rb') as f:
                 content = f.read()
                 
             self.send_response(200)
             ctype, _ = mimetypes.guess_type(path)
             if not ctype:
                 if path.endswith('.js'):
                     ctype = 'application/javascript'
                 elif path.endswith('.glsl'):
                     ctype = 'application/javascript'
                 else:
                     ctype = 'application/octet-stream'
             
             self.send_header('Content-Type', ctype)
             self.send_header('Content-Length', str(file_size))
             self.send_header('Access-Control-Allow-Origin', '*')
             self.end_headers()
             self.wfile.write(content)
         except Exception as e:
             print(f"Error serving {path}: {e}")
             self.send_error(500)


print(f"Starting XR Dev Server on port {PORT}")
# Use ThreadingTCPServer to handle parallel requests (avoids 502s on blocking)
class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

with ThreadingHTTPServer(("", PORT), XRDevHandler) as httpd:
    httpd.serve_forever()
