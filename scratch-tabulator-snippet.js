const fs = require('fs');
const s = fs.readFileSync('site/vendor/tabulator/tabulator.min.js', 'utf8');
const needle = 'data-page",e),t.textContent=e';
const i = s.indexOf(needle);
console.log(s.slice(Math.max(0, i - 100), i + 450));
