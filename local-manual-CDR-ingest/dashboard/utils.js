(function () {
  'use strict';

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  window.LocalCdrUtils = { cssVar };
})();
