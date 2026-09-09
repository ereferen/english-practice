#!/usr/bin/env python3
"""LLM CORS relay for the English Practice app (issue #80).

Browser fetch() from http://192.168.68.52/english/ cannot call most hosted
LLM APIs (opencode.ai, openrouter.ai, ...) because they don't send CORS
headers. This tiny stdlib relay forwards OpenAI-compatible requests from
the LAN to an allowlisted upstream and adds permissive CORS, so the app
just points its endpoint at the relay.

Usage:
    python3 scripts/llm-cors-relay.py --listen 8910 \
        --allow https://opencode.ai/zen/go/v1 \
        --allow https://openrouter.ai/api/v1 \
        --allow http://127.0.0.1:11434/v1

Then in the app Settings:
    API Endpoint: http://192.168.68.52:8910/opencode.ai/zen/go/v1
    (path after the port = the allowlisted upstream, so one relay serves
     every provider; keys/models stay in the app.)

Only HTTPS/HTTP absolute origins listed via --allow are reachable;
anything else gets 403 (no open proxy).
"""
import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ALLOWED: list[str] = []  # normalized upstream origins, e.g. https://host/v1


def norm(s: str) -> str:
    return s.strip().rstrip("/")


class Relay(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self, code: int, extra_headers=None):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, Authorization"
        )
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)

    def do_OPTIONS(self):
        self._cors(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _match_upstream(self) -> str | None:
        # /opencode.ai/zen/go/v1/chat/completions -> https://opencode.ai/zen/go/v1
        path = self.path.split("?")[0]
        for tail in ("/chat/completions", "/models"):
            if path.endswith(tail):
                prefix = norm(path[: -len(tail)]).lstrip("/")
                for up in ALLOWED:
                    parsed = urllib.parse.urlsplit(up)
                    if parsed.netloc + parsed.path == prefix:
                        return up + tail
        return None

    def do_POST(self):
        target = self._match_upstream()
        if not target:
            self._cors(403)
            self.send_header("Content-Type", "application/json")
            body = json.dumps(
                {
                    "error": {
                        "message": "upstream not allowlisted; pass --allow <origin>",
                        "type": "relay_error",
                    }
                }
            ).encode()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "english-practice-cors-relay/1",
        }
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        req = urllib.request.Request(target, data=payload, headers=headers)
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=120) as up:
                data = up.read()
                ctype = up.headers.get("Content-Type", "application/json")
                self._cors(
                    up.status, {"Content-Type": ctype, "Cache-Control": "no-cache"}
                )
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self._cors(e.code, {"Content-Type": "application/json"})
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            data = json.dumps(
                {"error": {"message": f"relay upstream failure: {e}"}}
            ).encode()
            self._cors(502, {"Content-Type": "application/json"})
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def log_message(self, fmt, *args):  # keep quiet, one line per request
        sys.stderr.write(f"[relay] {args[0]}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--listen", type=int, default=8910)
    ap.add_argument(
        "--allow",
        action="append",
        default=[],
        help="upstream origin to allowlist (repeatable)",
    )
    args = ap.parse_args()
    if not args.allow:
        sys.exit("no --allow upstreams given; refusing to start an open proxy")
    ALLOWED.extend(norm(a) for a in args.allow)
    print(f"[relay] listening :{args.listen} -> {ALLOWED}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", args.listen), Relay).serve_forever()


if __name__ == "__main__":
    main()
