'use strict';

const path = require('path');
const { runTsScript } = require('../tools/node-scripts/runner.cjs');

runTsScript(path.join(__dirname, '..'), 'integrity/repair-preview.ts', process.argv.slice(2));
