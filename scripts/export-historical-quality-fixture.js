const path = require('path');
const { runTsScript } = require('../tools/node-scripts/runner.cjs');

runTsScript(path.resolve(__dirname, '..'), path.join('integrity', 'export-historical-quality-fixture.ts'), process.argv.slice(2));
