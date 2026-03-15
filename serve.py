import http.server
import ssl

server_address = ('0.0.0.0', 4433)
httpd = http.server.HTTPServer(server_address, http.server.SimpleHTTPRequestHandler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.check_hostname = False
ctx.load_cert_chain(certfile="cert.pem", keyfile="key.pem")

httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print("Serving on https://0.0.0.0:4433")
httpd.serve_forever()
