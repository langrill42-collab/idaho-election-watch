"""Run Election Watch in a Mac window or a local browser."""

import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import threading
from urllib.parse import unquote, urlsplit

from election_data import DATA, ROOT, ElectionStore, read_json

PORT = 8766
ORIGIN = f"http://127.0.0.1:{PORT}"


def geometry():
    return {"legislative": read_json(DATA / "legislative.geojson"),
            "counties": read_json(DATA / "counties.geojson"),
            "adaPrecincts": read_json(DATA / "ada-precincts.geojson")}


def create_server(store):
    geo = geometry()

    class Handler(BaseHTTPRequestHandler):
        def send(self, value, status=200):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == "/api/health":
                return self.send({"application": "idaho-election-watch", "version": "0.1.0"})
            if route == "/api/data":
                data = store.get()
                return self.send(data if data else {"error": "Official data is loading. Try refresh in a moment."}, 200 if data else 503)
            if route == "/api/geometry":
                return self.send(geo)
            static = ROOT / "static"
            relative = "index.html" if route == "/" else unquote(route.removeprefix("/static/")).lstrip("/")
            path = (static / relative).resolve()
            if not path.is_relative_to(static) or not path.is_file():
                return self.send({"error": "Not found"}, 404)
            body = path.read_bytes()
            content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            if self.headers.get("Origin") not in (None, ORIGIN):
                return self.send({"error": "Local requests only"}, 403)
            if urlsplit(self.path).path != "/api/refresh":
                return self.send({"error": "Not found"}, 404)
            try:
                data = store.refresh()
                return self.send(data if data else {"error": "No official results snapshot is available yet."}, 200 if data else 503)
            except Exception as error:
                return self.send({"error": str(error)}, 503)

        def log_message(self, fmt, *args):
            if args and args[1:2] != ("200",):
                super().log_message(fmt, *args)

    return ThreadingHTTPServer(("127.0.0.1", PORT), Handler)


def update_loop(store, stop):
    while not stop.is_set():
        try:
            fetched = store.finance.get("fetchedAt")
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched)).total_seconds() if fetched else float("inf")
            if age > 3600:
                try:
                    store.refresh_finance()
                except Exception as error:
                    print(f"Fundraising update unavailable; keeping cached figures: {error}", flush=True)
            store.refresh()
        except Exception as error:
            print(f"Results update unavailable: {error}", flush=True)
        stop.wait(60)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="Serve locally without opening a window")
    parser.add_argument("--desktop", action="store_true", help="Open the Mac desktop window (default)")
    args = parser.parse_args()
    stop = threading.Event()
    server = None
    try:
        store = ElectionStore()
        server = create_server(store)
        threading.Thread(target=update_loop, args=(store, stop), daemon=True).start()
    except OSError:
        from urllib.request import urlopen
        with urlopen(ORIGIN + "/api/health", timeout=2) as response:
            if json.load(response).get("application") != "idaho-election-watch":
                raise RuntimeError(f"Port {PORT} is in use by another application.")
        if args.serve:
            print(f"Election Watch is already running at {ORIGIN}")
            return
    print(f"Election Watch: {ORIGIN}", flush=True)
    try:
        if args.serve:
            server.serve_forever()
        else:
            if server:
                threading.Thread(target=server.serve_forever, daemon=True).start()
            import webview
            webview.create_window("Idaho Election Watch", ORIGIN, width=1500, height=960,
                                  min_size=(1050, 700), text_select=True, background_color="#f5f3ed")
            storage = DATA / "window"
            storage.mkdir(parents=True, exist_ok=True)
            webview.start(private_mode=False, storage_path=str(storage))
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        if server:
            if not args.serve:
                server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
