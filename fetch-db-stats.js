'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'fetch-db-stats.ts', process.argv.slice(2));
