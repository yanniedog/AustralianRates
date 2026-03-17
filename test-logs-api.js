'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'test-logs-api.ts', process.argv.slice(2));
