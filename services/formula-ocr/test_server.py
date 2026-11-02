"""Проверка HTTP-обёртки с подставной моделью: python3 -m unittest test_server"""

import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from server import PNG_SIGNATURE, make_handler

PNG = PNG_SIGNATURE + b"\x00" * 32


class ServerTest(unittest.TestCase):
    def start(self, predict, key=""):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(predict, key))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{srv.server_address[1]}"

    def post(self, url, body, headers=None):
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "image/png", **(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_recognizes_png(self):
        seen = []
        url = self.start(lambda png: seen.append(png) or "\\frac{a}{b}")
        self.assertEqual(self.post(url + "/predict", PNG), (200, {"latex": "\\frac{a}{b}"}))
        self.assertEqual(seen, [PNG])
        with urllib.request.urlopen(url + "/health") as r:
            self.assertEqual(json.loads(r.read()), {"status": "ok"})

    def test_rejects_not_png(self):
        url = self.start(lambda png: "x")
        self.assertEqual(self.post(url + "/predict", b"%PDF-1.4")[0], 415)

    def test_requires_key(self):
        url = self.start(lambda png: "x", key="k1")
        self.assertEqual(self.post(url + "/predict", PNG)[0], 401)
        self.assertEqual(self.post(url + "/predict", PNG, {"Authorization": "Bearer k2"})[0], 401)
        self.assertEqual(self.post(url + "/predict", PNG, {"Authorization": "Bearer k1"}), (200, {"latex": "x"}))

    def test_model_error_is_500_without_details(self):
        def fail(png):
            raise RuntimeError("секретный путь /models")

        url = self.start(fail)
        status, body = self.post(url + "/predict", PNG)
        self.assertEqual(status, 500)
        self.assertNotIn("models", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
