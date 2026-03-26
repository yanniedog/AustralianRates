'use strict';

const { runTsScript } = require('./tools/node-scripts/runner.cjs');

runTsScript(__dirname, 'doctor.ts', process.argv.slice(2));
