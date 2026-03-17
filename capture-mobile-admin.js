'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'capture-mobile-admin-screenshots.ts', process.argv.slice(2));
