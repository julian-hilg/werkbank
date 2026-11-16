export interface ChartLibrary {
  title: string;
  /** The global variable the library defines inside the element. */
  global: string;
  description: string;
  /** The library's source text. */
  load: () => Promise<string>;
}
/** Pass as `custom.libraries` in the Werkbank config. */
export declare const chartLibraries: Record<"echarts" | "d3" | "chartjs" | "lightweight-charts" | "plotly", ChartLibrary>;
