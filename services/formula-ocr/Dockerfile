# Распознавание рукописных формул: pix2tex (LaTeX-OCR) на CPU.
# Сборка: docker compose --profile ocr build formula-ocr
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# PyTorch только для процессора: образ в несколько раз меньше, чем с CUDA.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.4.1 \
 && pip install pix2tex==0.1.4 "albumentations==1.4.24" "Pillow>=10,<12"

# Веса модели скачиваются при сборке: контейнеру не нужен интернет при работе.
RUN python -c "from pix2tex.cli import LatexOCR; LatexOCR()"

WORKDIR /app
COPY server.py /app/server.py

USER nobody
EXPOSE 8502
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8502/health')"
CMD ["python", "/app/server.py"]
