"""A Lelap add-on on Python's standard library: one catalog, meta and streams.

Run it with `python3 addon.py` and open http://localhost:8787/manifest.json.
"""

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

MANIFEST = {
    # Use a reverse-DNS ID of a domain you control.
    "id": "org.example.python",
    "version": "1.0.0",
    "protocol": 1,
    # Revision 2 adds `behaviorHints` and `GET /health`; older apps ignore both.
    "protocolVersion": 2,
    "name": "Python example",
    "description": "Two public-domain LibriVox recordings, served by the standard library.",
    "types": ["audiobook"],
    "resources": ["catalog", "meta", "stream"],
    "idPrefixes": ["example:"],
    "catalogs": [
        {"type": "audiobook", "id": "classics", "name": "Classics", "extra": [{"name": "skip"}]}
    ],
    "behaviorHints": {"health": True},
}


def archive(item, file):
    return "https://archive.org/download/%s/%s" % (item, file)


# Replace these with your own source. Only serve audio you are allowed to share.
CAROL_PARTS = [
    ("Preface and Stave 1", "A_Christmas_Carol_Preface_and_Stave_1_Dickens_64kb.mp3", 2680000),
    ("Stave 2", "A_Christmas_Carol_Stave_2_Dickens_64kb.mp3", 2660000),
    ("Stave 3", "A_Christmas_Carol_Stave_3_Dickens_64kb.mp3", 2674000),
    ("Stave 4", "A_Christmas_Carol_Stave_4_Dickens_64kb.mp3", 2529000),
    ("Stave 5", "A_Christmas_Carol_Stave_5_Dickens_64kb.mp3", 1126000),
]

BOOKS = [
    {
        "meta": {
            "id": "example:raven",
            "type": "audiobook",
            "name": "The Raven",
            "author": "Edgar Allan Poe",
            "cover": "https://archive.org/services/img/raven",
            "year": 1845,
            "durationMs": 570000,
            "description": "A grieving narrator is visited at midnight by a talking raven.",
            "language": "en",
        },
        "streams": [
            {
                "sourceKey": "example:raven:64kb",
                "name": "Python example",
                "title": "LibriVox recording",
                "url": archive("raven", "raven_poe_64kb.mp3"),
                "durationMs": 570000,
                "mime": "audio/mpeg",
                "downloadable": True,
            }
        ],
    },
    {
        "meta": {
            "id": "example:christmas-carol",
            "type": "audiobook",
            "name": "A Christmas Carol",
            "author": "Charles Dickens",
            "cover": "https://archive.org/services/img/A_Christmas_Carol",
            "year": 1843,
            "durationMs": 11669000,
            "description": "Ebenezer Scrooge is visited by three spirits on Christmas Eve.",
            "language": "en",
        },
        "streams": [
            {
                "sourceKey": "example:christmas-carol:64kb",
                "name": "Python example",
                "title": "LibriVox recording",
                "mime": "audio/mpeg",
                "downloadable": True,
                "parts": [
                    {
                        "title": title,
                        "url": archive("A_Christmas_Carol", file),
                        "durationMs": duration,
                    }
                    for title, file, duration in CAROL_PARTS
                ],
            }
        ],
    },
]

PAGE = 50
DAY = 86400
PREVIEW_FIELDS = ("id", "type", "name", "author", "cover", "year")

# /{resource}/{type}/{id}.json or /catalog/{type}/{id}/{extra}.json, with IDs percent-encoded.
ROUTE = re.compile(r"^/(catalog|meta|stream)/([^/]+)/([^/]+?)(?:/([^/]*))?\.json$")


def not_found(error="Not found"):
    return 404, {"error": error}, None


def route(path):
    """Answers one request path with (status, body, max_age). Pure, so tests need no server."""
    if path == "/manifest.json":
        return 200, MANIFEST, 3600
    if path == "/health":
        # Check what your add-on relies on here; "degraded" or "down" with a short message.
        return 200, {"status": "ok"}, 0
    match = ROUTE.match(path)
    if not match:
        return not_found()
    resource, kind, raw_id, raw_extra = match.groups()
    # Split first, then decode: a `/` inside an ID arrives as %2F.
    item_id = unquote(raw_id)
    if kind != "audiobook":
        return not_found()

    if resource == "catalog":
        if item_id != "classics":
            return not_found("Unknown catalog")
        # Extras are a query string in a path segment; parse_qs decodes `+` as a space too.
        extra = parse_qs(raw_extra or "")
        skip = extra.get("skip", ["0"])[0]
        if not skip.isdigit():
            return 400, {"error": "skip must be a whole number"}, None
        start = int(skip)
        metas = [
            {key: book["meta"][key] for key in PREVIEW_FIELDS if key in book["meta"]}
            for book in BOOKS[start : start + PAGE]
        ]
        return 200, {"metas": metas, "cacheMaxAge": 6 * 3600}, 6 * 3600
    if raw_extra is not None:
        return not_found()

    book = next((b for b in BOOKS if b["meta"]["id"] == item_id), None)
    if resource == "meta":
        if book is None:
            return not_found()
        return 200, {"meta": book["meta"], "cacheMaxAge": DAY}, DAY
    # No streams is an empty list, not an error.
    streams = book["streams"] if book else []
    return 200, {"streams": streams, "cacheMaxAge": DAY}, DAY


# Every response, errors included, needs CORS: the web app calls add-ons from the browser.
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


class AddonHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        for name, value in CORS.items():
            self.send_header(name, value)
        self.end_headers()

    def do_GET(self):
        self.answer(*route(urlsplit(self.path).path), send_body=True)

    def do_HEAD(self):
        self.answer(*route(urlsplit(self.path).path), send_body=False)

    def do_POST(self):
        self.answer(405, {"error": "Method not allowed"}, None, send_body=True)

    do_PUT = do_DELETE = do_PATCH = do_POST

    def answer(self, status, body, max_age, send_body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        for name, value in CORS.items():
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if max_age is not None:
            self.send_header("Cache-Control", "public, max-age=%d" % max_age)
        self.end_headers()
        if send_body:
            self.wfile.write(data)


def create_server(port=8787, host=""):
    return ThreadingHTTPServer((host, port), AddonHandler)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    print("Add-on running: http://localhost:%d/manifest.json" % port)
    create_server(port).serve_forever()
