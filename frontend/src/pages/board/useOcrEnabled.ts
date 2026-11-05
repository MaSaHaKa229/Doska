import { useEffect, useState } from 'react';
import { formulaApi } from '../../api/formula';

/** Включено ли распознавание рукописных формул (FORMULA_OCR_URL на сервере). */
export function useOcrEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void formulaApi.ocrEnabled().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}
