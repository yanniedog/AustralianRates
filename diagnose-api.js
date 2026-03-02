'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'diagnose-api.ts', process.argv.slice(2));