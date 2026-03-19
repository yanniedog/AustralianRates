/**
 * Esbuild entry: exposes the full lightweight-charts public API on globalThis for static pages.
 */
import * as LightweightCharts from 'lightweight-charts';

var g = typeof globalThis !== 'undefined' ? globalThis : window;
g.LightweightCharts = LightweightCharts;
