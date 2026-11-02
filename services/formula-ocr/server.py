"""
HTTP-обёртка над pix2tex (LaTeX-OCR) для распознавания рукописных формул.

Протокол (его ждёт бэкенд доски, переменная FORMULA_OCR_URL):
  POST /predict   тело — картинка PNG (Content-Type: image/png),
                  при заданном OCR_API_KEY — заголовок Authorization: Bearer <ключ>;
                  ответ — JSON {"latex": "..."}.
  GET  /health    {"status": "ok"} — модель загружена.

Только стандартная библиотека Python, без веб-фреймворков. Модель вызывается
по очереди (одна блокировка): pix2tex не рассчитан на параллельные вызовы.
"""

import hmac
import io
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

MAX_BYTES = 4 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

log = logging.getLogger("formula-ocr")


def make_handler(predict: Callable[[bytes], str], api_key: str = ""):
    """Обработчик запросов; predict(png) -> LaTeX (подменяется в тестах)."""
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "formula-ocr"
        sys_version = ""

        def log_message(self, fmt, *args):  # журнал через logging, без тела запроса
            log.info("%s %s", self.address_string(), fmt % args)

        def _json(self, status: int, body: object) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok"})
            else:
                self._json(404, {"error": "не найдено"})

        def do_POST(self):
            if self.path.rstrip("/") not in ("", "/predict"):
                self._json(404, {"error": "не найдено"})
                return
            if api_key:
                given = self.headers.get("Authorization", "")
                if not hmac.compare_digest(given.encode(), f"Bearer {api_key}".encode()):
                    self._json(401, {"error": "нужен ключ доступа"})
                    return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BYTES:
                self._json(413 if length > MAX_BYTES else 400, {"error": "неверный размер картинки"})
                return
            data = self.rfile.read(length)
            if not data.startswith(PNG_SIGNATURE):
                self._json(415, {"error": "ожидалась картинка PNG"})
                return
            try:
                with lock:
                    latex = predict(data)
            except Exception:  # noqa: BLE001 — подробности только в журнал
                log.exception("ошибка распознавания")
                self._json(500, {"error": "не удалось распознать"})
                return
            self._json(200, {"latex": latex})

    return Handler


def load_model() -> Callable[[bytes], str]:
    """Модель pix2tex (веса скачаны при сборке образа)."""
    from PIL import Image
    from pix2tex.cli import LatexOCR

    model = LatexOCR()

    def predict(png: bytes) -> str:
        with Image.open(io.BytesIO(png)) as img:
            return str(model(img.convert("RGB")))

    return predict


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8502"))
    handler = make_handler(load_model(), os.environ.get("OCR_API_KEY", ""))
    log.info("распознавание формул слушает %s:%d", host, port)
    ThreadingHTTPServer((host, port), handler).serve_forever()


if __name__ == "__main__":
    main()
