'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'run-admin-status-checks.ts', process.argv.slice(2));
