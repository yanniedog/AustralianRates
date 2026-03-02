'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'test-table-error-detect.ts', process.argv.slice(2));