'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'trigger-retention.ts', process.argv.slice(2));
