'use strict';

const path = require('path');
const { runTsScript } = require('../tools/node-scripts/runner.cjs');

runTsScript(path.join(__dirname, '..'), 'integrity/data-integrity-audit-prod.ts', process.argv.slice(2));
