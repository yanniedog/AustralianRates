'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'set-pages-build-config.ts', process.argv.slice(2));