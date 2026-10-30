# Static server for the demo with caching disabled, so edits show on plain reload.
import functools, http.server, os

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

class S(http.server.ThreadingHTTPServer):
    # Hikari loads many ES modules together when a trial opens.
    request_queue_size = 256

S(("127.0.0.1", 8790), functools.partial(H, directory=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hikari-is"))).serve_forever()
