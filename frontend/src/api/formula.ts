import { http, request } from './http';

let status: Promise<boolean> | null = null;

export const formulaApi = {
  /** Включено ли распознавание рукописных формул на сервере (запрашивается один раз). */
  ocrEnabled: (): Promise<boolean> => {
    status ??= http
      .get<{ enabled: boolean }>('/api/formula-ocr')
      .then((r) => r.enabled)
      .catch(() => {
        status = null;
        return false;
      });
    return status;
  },
  /** Распознать рукопись (PNG) — LaTeX. */
  recognize: (png: Blob, signal?: AbortSignal) =>
    request<{ latex: string }>('POST', '/api/formula-ocr', { raw: { data: png, contentType: 'image/png' }, signal }).then((r) => r.latex),
};
