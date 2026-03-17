'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'beta-test-capture-log.ts', process.argv.slice(2));
