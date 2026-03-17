'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'fetch-production-logs.ts', process.argv.slice(2));
