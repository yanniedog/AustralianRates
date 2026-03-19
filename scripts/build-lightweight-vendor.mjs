#!/usr/bin/env node
/**
 * Bundles TradingView lightweight-charts into a single IIFE for site/vendor (no npm import in browser).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'site', 'vendor', 'lightweight-charts');
const outfile = path.join(outDir, 'lightweight-charts.bundle.js');
const entry = path.join(__dirname, 'lightweight-charts-vendor-entry.js');

fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  outfile,
  minify: true,
  legalComments: 'none',
  platform: 'browser',
  target: ['es2020'],
});

console.log('[build-lightweight-vendor] wrote', path.relative(root, outfile));
