'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'diagnose-pages.ts', process.argv.slice(2));
