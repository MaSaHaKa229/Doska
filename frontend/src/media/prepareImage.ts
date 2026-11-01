/** Наибольшая сторона картинки после подготовки (больше на доске не нужно). */
export const MAX_IMAGE_SIDE = 4096;

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

export function isImageFile(f: { type: string; name: string }): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(f.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name);
}

export function isPdfFile(f: { type: string; name: string }): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
}

/** Размер после вписывания в квадрат max×max (пропорции сохраняются). */
export function fitSize(w: number, h: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать картинку'));
    img.src = url;
  });
}

/**
 * Подготовка картинки перед загрузкой: поворот по EXIF (снимок с телефона
 * не окажется боком), уменьшение до 4096 пикселей по стороне и
 * перекодирование — оно же убирает метаданные (координаты съёмки).
 * SVG превращается в PNG: векторные файлы с возможными скриптами сервер не
 * принимает. GIF загружается как есть, чтобы не потерять анимацию.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === 'image/gif') return { blob: file, name: file.name };
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  const url = URL.createObjectURL(file);
  try {
    if (isSvg) {
      const img = await loadImageElement(url);
      // У SVG без размеров берём 1024 по ширине.
      w = img.naturalWidth || 1024;
      h = img.naturalHeight || Math.round(w * 0.75);
      source = img;
    } else {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = bmp.width;
      h = bmp.height;
      source = bmp;
    }
    const size = fitSize(w, h);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось подготовить картинку');
    ctx.drawImage(source, 0, 0, size.width, size.height);
    if (source instanceof ImageBitmap) source.close();
    // Прозрачность бывает у PNG, WebP и SVG — их сохраняем в PNG, фотографии — в JPEG.
    const keepAlpha = isSvg || file.type === 'image/png' || file.type === 'image/webp';
    const type = keepAlpha ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
    if (!blob) throw new Error('Не удалось подготовить картинку');
    const base = file.name.replace(/\.[^.]+$/, '') || 'картинка';
    return { blob, name: `${base}.${keepAlpha ? 'png' : 'jpg'}` };
  } finally {
    URL.revokeObjectURL(url);
  }
}
