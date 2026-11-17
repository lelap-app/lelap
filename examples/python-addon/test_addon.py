import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from addon import MANIFEST, AddonHandler, create_server, route


class QuietHandler(AddonHandler):
    def log_message(self, format, *args):
        pass


class AddonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(port=0, host="127.0.0.1")
        cls.server.RequestHandlerClass = QuietHandler
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, method="GET"):
        try:
            response = urlopen(Request(self.base + path, method=method))
        except HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, response.headers, json.loads(raw) if raw else None

    def test_manifest_with_cors(self):
        status, headers, body = self.request("/manifest.json")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertTrue(headers["Content-Type"].startswith("application/json"))
        self.assertEqual(body, MANIFEST)

    def test_catalog_and_paging(self):
        _, _, body = self.request("/catalog/audiobook/classics.json")
        self.assertEqual(
            [m["id"] for m in body["metas"]], ["example:raven", "example:christmas-carol"]
        )
        _, _, page = self.request("/catalog/audiobook/classics/skip=50.json")
        self.assertEqual(page["metas"], [])
        status, _, _ = self.request("/catalog/audiobook/classics/skip=-1.json")
        self.assertEqual(status, 400)

    def test_meta_for_a_percent_encoded_id(self):
        status, headers, body = self.request("/meta/audiobook/example%3Araven.json")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "public, max-age=86400")
        self.assertEqual(body["meta"]["name"], "The Raven")

    def test_single_file_and_parts(self):
        _, _, raven = self.request("/stream/audiobook/example%3Araven.json")
        self.assertTrue(raven["streams"][0]["url"].startswith("https://"))
        _, _, carol = self.request("/stream/audiobook/example%3Achristmas-carol.json")
        parts = carol["streams"][0]["parts"]
        self.assertEqual(len(parts), 5)
        self.assertTrue(all(isinstance(p["durationMs"], int) for p in parts))

    def test_errors_are_json_with_cors(self):
        for path in (
            "/meta/audiobook/example%3Anope.json",
            "/catalog/audiobook/nope.json",
            "/meta/podcast/example%3Araven.json",
            "/nope",
        ):
            status, headers, body = self.request(path)
            self.assertEqual(status, 404, path)
            self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
            self.assertIsInstance(body["error"], str)
        self.assertEqual(route("/stream/audiobook/example%3Anope.json")[1]["streams"], [])

    def test_preflight_and_other_methods(self):
        status, headers, _ = self.request("/manifest.json", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        status, _, _ = self.request("/manifest.json", method="POST")
        self.assertEqual(status, 405)


if __name__ == "__main__":
    unittest.main()
