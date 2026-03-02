'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'write-deploy-version.ts', process.argv.slice(2));