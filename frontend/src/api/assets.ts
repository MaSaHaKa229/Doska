import type { AssetView } from '@doska/shared';
import { request } from './http';

export const assetsApi = {
  /** Загрузить картинку или PDF на доску. Тип файла сервер определит по содержимому. */
  upload: (boardId: string, file: Blob, name: string) =>
    request<{ asset: AssetView }>('POST', `/api/boards/${boardId}/assets`, {
      raw: { data: file, contentType: 'application/octet-stream', headers: { 'x-file-name': encodeURIComponent(name.slice(0, 200)) } },
    }),
};
