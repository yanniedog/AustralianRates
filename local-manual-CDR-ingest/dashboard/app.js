(function () {
  'use strict';

  const state = { section: 'Mortgage', sector: 'banks', manifest: null, banks: null, energy: null, descending: false };
  const $ = (id) => document.getElementById(id);

  async function getJson(url) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(url + ' returned ' + response.status);
    return response.json();
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function pct(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return '';
    return (value * 100).toFixed(2) + '%';
  }

  function num(value) {
    return Number(value || 0).toLocaleString('en-AU');
  }

  function rateRows() {
    const q = $('query').value.trim().toLowerCase();
    const provider = $('provider').value.trim().toLowerCase();
    const dataset = state.section === 'Energy' ? '' : ($('dataset').value || state.section);
    if (state.sector === 'banks') {
      if (!state.banks) return [];
      return state.banks.rates.filter((row) =>
        (!dataset || row.dataset === dataset) &&
        (!provider || String(row.provider || '').toLowerCase().includes(provider)) &&
        (!q || String(row.product_name || '').toLowerCase().includes(q))
      );
    }
    if (!state.energy) return [];
    return state.energy.plans.filter((row) =>
      (!provider || String(row.provider || '').toLowerCase().includes(provider)) &&
      (!q || String(row.plan_name || '').toLowerCase().includes(q))
    );
  }

  function chartRows(rows) {
    const mapped = state.sector === 'banks'
      ? rows.map((row) => ({ label: row.provider + ' - ' + row.product_name, value: Number(row.rate), meta: [row.dataset, row.rate_type, row.loan_purpose].filter(Boolean).join(' | ') }))
      : rows.map((row) => ({ label: row.provider + ' - ' + row.plan_name, value: 1, meta: [row.fuel_type, row.last_updated && row.last_updated.slice(0, 10)].filter(Boolean).join(' | ') }));
    return mapped.filter((row) => Number.isFinite(row.value) && (state.sector !== 'banks' || row.value > 0)).sort((a, b) => state.descending ? b.value - a.value : a.value - b.value).slice(0, 40);
  }

  function setLinks() {
    const date = state.manifest.run_date;
    const json = `/exports/${state.sector}-${date}.json`;
    const xlsx = `/exports/${state.sector}-${date}.xlsx`;
    $('jsonLink').href = json;
    $('xlsxLink').href = xlsx;
    $('footerJsonLink').href = json;
    $('footerXlsxLink').href = xlsx;
  }

  function setSectionUi() {
    document.body.classList.toggle('ar-section-home-loans', state.section === 'Mortgage');
    document.body.classList.toggle('ar-section-savings', state.section === 'Savings');
    document.body.classList.toggle('ar-section-term-deposits', state.section === 'TD');
    document.body.classList.toggle('ar-section-economic-data', state.section === 'Energy');
    document.querySelectorAll('[data-section]').forEach((button) => {
      const active = button.dataset.section === state.section;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    const titles = { Mortgage: 'Home loan rates, tracked.', Savings: 'Savings rates, tracked.', TD: 'Term deposit yields, tracked.', Energy: 'Energy plans, tracked.' };
    $('page-title').textContent = titles[state.section] || titles.Mortgage;
    const leaderLabels = { Mortgage: 'Lowest rate', Savings: 'Top yield', TD: 'Top yield', Energy: 'Plans' };
    const focusLabels = { Mortgage: 'Lowest rates', Savings: 'Top yields', TD: 'Top yields', Energy: 'Plan count' };
    $('hero-leader-label').textContent = leaderLabels[state.section] || leaderLabels.Mortgage;
    $('chart-focus').textContent = focusLabels[state.section] || focusLabels.Mortgage;
    $('chart-toggle-sort').textContent = state.descending ? 'Lowest first' : 'Highest first';
  }

  function setupFilters() {
    const dataset = $('dataset');
    if (state.sector === 'banks') {
      const values = [...new Set(state.banks.products.map((row) => row.dataset).filter(Boolean))].sort();
      dataset.innerHTML = '<option value="">All banking datasets</option>' + values.map((value) => `<option>${esc(value)}</option>`).join('');
      dataset.value = values.includes(state.section) ? state.section : '';
      dataset.disabled = false;
    } else {
      dataset.innerHTML = '<option value="">Energy plans</option>';
      dataset.disabled = true;
    }
  }

  function draw(items) {
    const canvas = $('chart');
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(800, Math.floor(rect.width * scale));
    canvas.height = Math.max(360, Math.floor(rect.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const width = canvas.width / scale;
    const height = canvas.height / scale;
    ctx.clearRect(0, 0, width, height);
    const left = 190;
    const top = 24;
    const rowHeight = Math.max(10, Math.min(18, (height - 48) / Math.max(items.length, 1)));
    const max = Math.max(...items.map((item) => item.value), 1);
    ctx.font = '12px "Space Grotesk", Segoe UI, sans-serif';
    items.forEach((item, index) => {
      const y = top + index * rowHeight;
      const bar = Math.max(3, (width - left - 92) * item.value / max);
      ctx.fillStyle = 'rgba(37,99,235,0.16)';
      ctx.fillRect(left, y, width - left - 92, Math.max(5, rowHeight - 5));
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(left, y, bar, Math.max(5, rowHeight - 5));
      ctx.fillStyle = '#24364a';
      ctx.fillText(item.label.slice(0, 24), 14, y + rowHeight - 6);
      ctx.fillText(state.sector === 'banks' ? pct(item.value) : String(Math.round(item.value)), left + bar + 8, y + rowHeight - 6);
    });
  }

  function updateHero(rows, items) {
    $('hero-run').textContent = state.manifest.run_date;
    $('hero-rows').textContent = num(rows.length);
    $('hero-leader').textContent = state.sector === 'banks' && items[0] ? pct(items[0].value) : num(rows.length);
    $('last-refreshed').textContent = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  }

  function renderStats(rows) {
    const counts = state.sector === 'banks' ? state.manifest.banks_counts : state.manifest.energy_counts;
    const entries = Object.entries(counts).slice(0, 6).concat([['visible rows', rows.length]]);
    $('stats').innerHTML = entries.map(([key, value]) =>
      `<div class="terminal-stat"><span class="metric-code">${esc(key)}</span><strong>${num(value)}</strong></div>`
    ).join('');
  }

  function renderRail(items) {
    $('chart-series-note').textContent = state.sector === 'banks' ? 'Top visible rates' : 'Visible plan sample';
    $('chart-series-list').innerHTML = items.slice(0, 24).map((item) =>
      `<article class="local-series-card" role="listitem"><strong>${esc(item.label)}</strong><span>${esc(item.meta || '')}</span><span>${state.sector === 'banks' ? pct(item.value) : 'Plan'}</span></article>`
    ).join('');
  }

  function renderTable(rows) {
    const keys = state.sector === 'banks'
      ? ['dataset', 'provider', 'product_name', 'rate', 'comparison_rate', 'rate_type', 'application_type', 'repayment_type', 'loan_purpose', 'term', 'last_updated']
      : ['provider', 'plan_name', 'fuel_type', 'last_updated', 'description'];
    const visible = rows.slice(0, 1500);
    $('table-count').textContent = num(visible.length) + ' visible';
    $('table').innerHTML = '<thead><tr>' + keys.map((key) => `<th>${esc(key)}</th>`).join('') + '</tr></thead><tbody>' +
      visible.map((row) => '<tr>' + keys.map((key) => {
        const value = key.includes('rate') ? pct(row[key]) || row[key] || '' : row[key] || '';
        return `<td class="${key.includes('rate') ? 'num' : ''}">${esc(value)}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
  }

  function render() {
    const rows = rateRows();
    const items = chartRows(rows);
    setLinks();
    updateHero(rows, items);
    renderStats(rows);
    renderRail(items);
    renderTable(rows);
    draw(items);
    $('chart-status').textContent = `${num(rows.length)} local ${state.sector === 'banks' ? 'rate rows' : 'plans'} loaded`;
  }

  async function loadSection(section) {
    state.section = section;
    state.sector = section === 'Energy' ? 'energy' : 'banks';
    state.descending = preferredDescending(section);
    setSectionUi();
    $('chart-status').textContent = 'Loading local CDR data';
    $('table-count').textContent = '';
    $('table').innerHTML = '';
    $('chart-series-list').innerHTML = '';
    if (!state[state.sector]) state[state.sector] = await getJson(`/api/${state.sector}?date=${state.manifest.run_date}`);
    setupFilters();
    render();
  }

  function bind() {
    document.querySelectorAll('[data-section]').forEach((button) => button.addEventListener('click', () => loadSection(button.dataset.section)));
    ['dataset', 'provider', 'query'].forEach((id) => $(id).addEventListener('input', render));
    $('refresh-page-btn').addEventListener('click', () => window.location.reload());
    $('chart-toggle-sort').addEventListener('click', () => {
      state.descending = !state.descending;
      $('chart-toggle-sort').textContent = state.descending ? 'Lowest first' : 'Highest first';
      render();
    });
    window.addEventListener('resize', () => render());
  }

  async function init() {
    state.manifest = await getJson('/api/latest');
    bind();
    await loadSection('Mortgage');
  }

  init().catch((error) => {
    document.body.innerHTML = '<pre class="panel" style="margin:20px">' + esc(error.stack || error.message || error) + '</pre>';
  });
})();
  function preferredDescending(section) {
    return section !== 'Mortgage';
  }
