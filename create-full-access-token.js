'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'create-full-access-token.ts', process.argv.slice(2));