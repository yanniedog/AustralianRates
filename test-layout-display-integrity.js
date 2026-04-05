'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'layout-display-integrity.ts', process.argv.slice(2));
