(function () {
  'use strict';

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function child(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    parent.appendChild(element);
    return element;
  }

  function num(value) {
    return Number(value || 0).toLocaleString('en-AU');
  }

  function pct(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return '';
    return (value * 100).toFixed(2) + '%';
  }

  function bestRate(rows, descending) {
    const values = rows.map((row) => Number(row.rate)).filter(Number.isFinite);
    if (!values.length) return null;
    return descending ? Math.max(...values) : Math.min(...values);
  }

  function clip(value, length) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > length ? text.slice(0, length - 1) + '...' : text;
  }

  function groupKey(prefix, value) {
    const raw = String(value || '');
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return prefix + ':' + (slug || 'item') + ':' + (hash >>> 0).toString(36);
  }

  function groupedRows(rows) {
    const providers = new Map();
    rows.forEach((row) => {
      const providerName = row.provider || 'Unknown provider';
      if (!providers.has(providerName)) providers.set(providerName, { name: providerName, products: new Map(), rows: [] });
      const provider = providers.get(providerName);
      const productId = row.product_key || row.product_id || row.product_name || 'Unknown product';
      if (!provider.products.has(productId)) {
        provider.products.set(productId, { id: productId, name: row.product_name || 'Unknown product', rows: [], category: row.category || '', updated: row.last_updated || '' });
      }
      provider.rows.push(row);
      provider.products.get(productId).rows.push(row);
    });
    return [...providers.values()];
  }

  function renderToggleCell(row, key, level, expanded) {
    const cell = child(row, 'td', 'local-tree-primary local-tree-level-' + level);
    const button = child(cell, 'button', 'local-tree-toggle', expanded ? '-' : '+');
    button.type = 'button';
    button.dataset.treeKey = key;
    button.dataset.treeLevel = level;
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    return cell;
  }

  function sortByBest(items, descending) {
    return items.sort((a, b) => {
      const av = bestRate(a.rows, descending);
      const bv = bestRate(b.rows, descending);
      return descending ? (bv || 0) - (av || 0) : (av || 0) - (bv || 0);
    });
  }

  function render(table, countEl, rows, state) {
    const groups = sortByBest(groupedRows(rows), state.descending);
    const productCount = new Set(rows.map((row) => row.product_key || row.product_id || row.product_name)).size;
    countEl.textContent = `${num(rows.length)} rates / ${num(productCount)} products / ${num(groups.length)} providers`;
    clear(table);
    const thead = child(table, 'thead');
    const header = child(thead, 'tr');
    ['Provider / product / rate', 'Best', 'Count', 'Type', 'Details', 'Updated'].forEach((key) => child(header, 'th', '', key));
    const tbody = child(table, 'tbody');
    groups.forEach((provider) => renderProvider(tbody, provider, state));
  }

  function renderProvider(tbody, provider, state) {
    const pKey = groupKey('provider', provider.name);
    const products = sortByBest([...provider.products.values()], state.descending);
    const providerOpen = !state.closedProviders.has(pKey);
    const pRow = child(tbody, 'tr', 'local-tree-row local-provider-row');
    const pCell = renderToggleCell(pRow, pKey, 'provider', providerOpen);
    window.LocalCdrBrand.appendProviderBadge(pCell, provider.name, true);
    child(pRow, 'td', 'num', pct(bestRate(provider.rows, state.descending)));
    child(pRow, 'td', 'num', `${num(provider.rows.length)} rates / ${num(products.length)} products`);
    child(pRow, 'td', '', state.section === 'TD' ? 'Term deposits' : state.section);
    child(pRow, 'td', '', provider.name);
    child(pRow, 'td', '', '');
    if (!providerOpen) return;
    products.forEach((product) => renderProduct(tbody, product, pKey, state));
  }

  function renderProduct(tbody, product, pKey, state) {
    const productKey = pKey + '|' + groupKey('product', product.id);
    const productOpen = state.openProducts.has(productKey);
    const productRow = child(tbody, 'tr', 'local-tree-row local-product-row');
    const productCell = renderToggleCell(productRow, productKey, 'product', productOpen);
    child(productCell, 'span', 'local-product-name', product.name);
    child(productRow, 'td', 'num', pct(bestRate(product.rows, state.descending)));
    child(productRow, 'td', 'num', num(product.rows.length));
    child(productRow, 'td', '', product.category);
    child(productRow, 'td', '', clip(product.rows[0] && product.rows[0].description, 140));
    child(productRow, 'td', '', product.updated ? product.updated.slice(0, 10) : '');
    if (!productOpen) return;
    product.rows.forEach((rate) => renderRate(tbody, rate));
  }

  function renderRate(tbody, rate) {
    const rateRow = child(tbody, 'tr', 'local-tree-row local-rate-row');
    child(rateRow, 'td', 'local-tree-primary local-tree-level-rate', [rate.rate_type, rate.application_type].filter(Boolean).join(' / ') || 'Rate');
    child(rateRow, 'td', 'num', pct(rate.rate));
    child(rateRow, 'td', 'num', rate.comparison_rate ? pct(rate.comparison_rate) : '');
    child(rateRow, 'td', '', rate.repayment_type || rate.application_frequency || '');
    child(rateRow, 'td', '', clip([rate.loan_purpose, rate.term, rate.tiers && rate.tiers !== '[]' ? rate.tiers : ''].filter(Boolean).join(' | '), 160));
    child(rateRow, 'td', '', rate.last_updated ? rate.last_updated.slice(0, 10) : '');
  }

  window.LocalCdrHierarchy = { render };
})();
