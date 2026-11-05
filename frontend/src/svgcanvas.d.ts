// Типы библиотеки svgcanvas (в пакете их нет): используется только экспорт SVG.
declare module 'svgcanvas' {
  export class Context {
    constructor(options: { width: number; height: number; document?: Document; enableMirroring?: boolean });
    getSerializedSvg(fixNamedEntities?: boolean): string;
    getSvg(): SVGSVGElement;
  }
}
