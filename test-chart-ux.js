'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'test-chart-ux.ts', process.argv.slice(2));
