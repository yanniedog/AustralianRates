import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTsScript } from '../tools/node-scripts/runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

runTsScript(path.join(__dirname, '..'), 'scripts/sync-hard-limits.ts', process.argv.slice(2));