'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'test-theme-contrast.ts', process.argv.slice(2));
