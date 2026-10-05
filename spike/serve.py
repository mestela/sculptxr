import http.server, ssl, sys
cert, key, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*'); super().end_headers()
s = http.server.ThreadingHTTPServer(('0.0.0.0', port), H)
c = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); c.load_cert_chain(cert, key)
s.socket = c.wrap_socket(s.socket, server_side=True); s.serve_forever()
