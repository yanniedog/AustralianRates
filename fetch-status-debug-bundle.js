'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'fetch-status-debug-bundle.ts', process.argv.slice(2));
