(function () {
    'use strict';
    window.AR = window.AR || {};

    var dom = window.AR.dom;
    var config = window.AR.config;
    var filters = window.AR.filters;
    var utils = window.AR.utils || {};
    var network = window.AR.network || {};
    var timeUtils = window.AR.time || {};
    var sectionConfig = window.AR.sectionConfig || {};
    var section = window.AR.section || 'home-loans';
    var els = dom && dom.els ? dom.els : {};
    var apiBase = config && config.apiBase ? config.apiBase : '';
    var requestTimeoutMs = Number(sectionConfig.requestTimeoutMs);
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) requestTimeoutMs = 10000;
    var buildFilterParams = filters && filters.buildFilterParams ? filters.buildFilterParams : function () { return {}; };
    var pct = utils.pct || function (v) { var n = Number(v); return Number.isFinite(n) ? n.toFixed(3) + '%' : '-'; };
    var esc = utils.esc || window._arEsc || function (value) { return String(value == null ? '' : value); };
    var clientLog = utils.clientLog || function () {};
    var requestJson = typeof network.requestJson === 'function' ? network.requestJson : null;
    var describeError = typeof network.describeError === 'function'
        ? network.describeError
        : function (error, fallback) { return String((error && error.message) || fallback || 'Request failed.'); };
    var bankBrand = window.AR.bankBrand || {};
    var uiIcons = (window.AR && window.AR.uiIcons) ? window.AR.uiIcons : {};
    var iconText = typeof uiIcons.text === 'function'
        ? uiIcons.text
        : function (_icon, label, className, textClassName) {
            var classes = ['ar-icon-label'];
            if (className) classes.push(className);
            return '' +
                '<span class="' + classes.join(' ') + '">' +
                    '<span class="' + esc(textClassName || 'ar-icon-label-text') + '">' + esc(label) + '</span>' +
                '</span>';
        };
    var QUICK_COMPARE_LIMIT = 5;
    var MORTGAGE_SAMPLE_SCENARIOS = [
        {
            label: 'OO P&I variable 80-85%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_80-85%' }
        },
        {
            label: 'OO P&I variable 70-80%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_70-80%' }
        },
        {
            label: 'OO P&I variable 60-70%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_60-70%' }
        },
        {
            label: 'OO P&I variable <=60%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_=60%' }
        },
        {
            label: 'OO P&I variable 85-90%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_85-90%' }
        },
        {
            label: 'OO P&I variable 90-95%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_90-95%' }
        },
        {
            label: 'OO P&I fixed 1y 80-85%',
            params: { security_purpose: 'owner_occupied', repayment_type: 'principal_and_interest', rate_structure: 'fixed_1yr', lvr_tier: 'lvr_80-85%' }
        },
        {
            label: 'Investment P&I variable 80-85%',
            params: { security_purpose: 'investment', repayment_type: 'principal_and_interest', rate_structure: 'variable', lvr_tier: 'lvr_80-85%' }
        }
    ];
    var ladderRows = [];
    var publicIntro = window.AR.publicIntro || null;
    var heroStatsReady = false;
    var landingOverview = null;
    var quickCompareRequestSeq = 0;
    var SNAPSHOT_IGNORE_PARAMS = {
        cache_bust: true,
        chart_window: true,
        dataset_mode: true,
        dir: true,
        end_date: true,
        exclude_compare_edge_cases: true,
        include_manual: true,
        include_removed: true,
        limit: true,
        mode: true,
        order_by: true,
        page: true,
        representation: true,
        size: true,
        sort: true,
        start_date: true,
    };

    function syncPublicIntro() {
        publicIntro = window.AR.publicIntro || publicIntro;
        return publicIntro;
    }

    function snapshotData() {
        var snapshot = window.AR && window.AR.snapshot;
        return snapshot && snapshot.data ? snapshot.data : null;
    }

    function snapshotLatestAllRows() {
        var data = snapshotData();
        var latestAll = data && data.latestAll;
        return latestAll && Array.isArray(latestAll.rows) ? latestAll.rows : [];
    }

    function snapshotCurrentLeaders() {
        var data = snapshotData();
        var currentLeaders = data && data.currentLeaders;
        return currentLeaders && typeof currentLeaders === 'object' ? currentLeaders : null;
    }

    function pickLatestSnapshotRow(rows) {
        var best = null;
        (Array.isArray(rows) ? rows : []).forEach(function (row) {
            var date = String(row && row.collection_date || '').slice(0, 10);
            if (!date) return;
            if (!best || date > String(best.collection_date || '').slice(0, 10)) best = row;
        });
        return best;
    }

    function setIntroMetric(id, value, note) {
        var intro = syncPublicIntro();
        if (!intro || typeof intro.setLiveMetric !== 'function') return;
        intro.setLiveMetric(id, value, note);
    }

    function renderStat(el, icon, label, value, help) {
        if (!el) return;
        el.innerHTML = '<span class="metric-code">' + iconText(icon, label) + '</span><strong>' + esc(value) + '</strong>';
        if (help) el.setAttribute('data-help', help);
    }

    function setInlineError(el, message) {
        var text = String(message || '').trim();
        if (!el) return;
        el.textContent = text;
        el.hidden = !text;
    }

    function setStatUnavailable(el) {
        var valueEl;
        if (!el) return;
        valueEl = el.querySelector('strong');
        if (valueEl) valueEl.textContent = 'Unavailable';
    }

    function clearHeroError() {
        setInlineError(els.heroError, '');
    }

    function showHeroError() {
        setInlineError(els.heroError, 'Overview metrics are temporarily unavailable. Refresh to try again.');
        [els.statUpdated, els.statCashRate, els.statRecords].forEach(setStatUnavailable);
        if (els.statFeeds) setStatUnavailable(els.statFeeds);
    }

    function formatOverviewDatetime(isoOrSqlite) {
        if (!isoOrSqlite || typeof isoOrSqlite !== 'string') return '';
        var s = isoOrSqlite.trim();
        if (!s) return '';
        try {
            var d = new Date(s);
            if (isNaN(d.getTime())) return s;
            return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
        } catch (e) {
            return s;
        }
    }

    function applyLandingOverview() {
        if (!landingOverview) return;
        if (section === 'home-loans' && els.statCashRate && landingOverview.rba) {
            var rba = landingOverview.rba;
            var rateChanged = rba.effective_date ? 'Rate changed: ' + rba.effective_date + '.' : '';
            var lastChecked = rba.fetched_at ? 'Last checked: ' + formatOverviewDatetime(rba.fetched_at) + '.' : '';
            var help = ['Current RBA cash rate.', rateChanged, lastChecked].filter(Boolean).join(' ');
            els.statCashRate.setAttribute('data-help', help);
            els.statCashRate.setAttribute('title', help);
        }
        if (els.statFeeds && landingOverview.feeds) {
            var f = landingOverview.feeds;
            var feedDate = f.last_collection_date || f.last_parsed_at;
            var feedValue = feedDate ? formatOverviewDatetime(f.last_parsed_at || f.last_collection_date) : '...';
            var feedHelp = 'Last collected and stored: ' + (f.last_parsed_at ? formatOverviewDatetime(f.last_parsed_at) : f.last_collection_date || '—') + '.';
            if (f.latest_bank || f.latest_product) {
                feedHelp += ' Latest stored: ' + [f.latest_bank, f.latest_product].filter(Boolean).join(' – ') + '.';
            }
            renderStat(els.statFeeds, 'calendar', 'Bank feeds', feedValue, feedHelp);
            els.statFeeds.setAttribute('title', feedHelp);
        }
    }

    function applyHeroSnapshot(total, latest) {
        if (!Number.isFinite(Number(total))) return false;
        clearHeroError();
        renderStat(els.statRecords, 'rows', 'Rows', Number(total).toLocaleString(), 'Total rows in the active slice.');
        setIntroMetric('rows', Number(total).toLocaleString(), 'Rows in the current filtered slice.');

        if (els.statUpdated) {
            if (latest && latest.collection_date) {
                var renderedDate = timeUtils.formatSourceDateWithLocal
                    ? timeUtils.formatSourceDateWithLocal(latest.collection_date, latest.parsed_at)
                    : { text: String(latest.collection_date) };
                renderStat(els.statUpdated, 'calendar', 'Updated', renderedDate.text, renderedDate.title || 'Last collection date in the active slice.');
                setIntroMetric('updated', renderedDate.text, 'Latest collection in the current filtered slice.');
            } else {
                renderStat(els.statUpdated, 'calendar', 'Updated', 'Unavailable', 'Last collection date in the active slice.');
            }
        }

        if (els.statCashRate) {
            if (section === 'home-loans' && latest && latest.rba_cash_rate != null) {
                var cashHelp = 'Current RBA cash rate.';
                if (landingOverview && landingOverview.rba) {
                    var r = landingOverview.rba;
                    cashHelp = ['Current RBA cash rate.', r.effective_date ? 'Rate changed: ' + r.effective_date + '.' : '', r.fetched_at ? 'Last checked: ' + formatOverviewDatetime(r.fetched_at) + '.' : ''].filter(Boolean).join(' ');
                }
                renderStat(els.statCashRate, 'stats', 'Cash rate', pct(latest.rba_cash_rate), cashHelp);
                els.statCashRate.setAttribute('title', cashHelp);
            } else if (section === 'home-loans') {
                renderStat(els.statCashRate, 'stats', 'Cash rate', 'Unavailable', 'Current RBA cash rate.');
            } else if (section !== 'home-loans') {
                renderStat(els.statCashRate, 'continuity', 'Series continuity', 'Healthy', 'Series continuity by canonical product_key.');
            }
        }
        applyLandingOverview();

        heroStatsReady = true;
        return true;
    }

    function syncHeroStatsFromSnapshot() {
        var data = snapshotData();
        if (!data) return false;
        if (data.overview && data.overview.ok) {
            landingOverview = {
                rba: data.overview.rba || null,
                feeds: data.overview.feeds || null,
            };
            applyLandingOverview();
        }
        var analytics = data.analyticsSeries || null;
        var total = analytics && Number.isFinite(Number(analytics.total)) ? Number(analytics.total) : NaN;
        var latest = pickLatestSnapshotRow(snapshotLatestAllRows());
        if (!Number.isFinite(total) || !latest) return !!landingOverview;
        return applyHeroSnapshot(total, latest);
    }

    function syncHeroStatsFromExplorer(snapshot) {
        var currentExplorer = window.AR.explorer || {};
        var state = snapshot && typeof snapshot === 'object'
            ? snapshot
            : (currentExplorer && typeof currentExplorer.getExplorerState === 'function' ? currentExplorer.getExplorerState() : null);
        if (!state || state.status !== 'ready') return false;
        return applyHeroSnapshot(state.total, state.latestRow);
    }

    function loadOverview() {
        var data = snapshotData();
        if (data && data.overview && data.overview.ok) {
            landingOverview = {
                rba: data.overview.rba || null,
                feeds: data.overview.feeds || null,
            };
            applyLandingOverview();
            return;
        }
        if (!apiBase || landingOverview !== null) return;
        var url = apiBase + '/overview';
        requestJson
            ? requestJson(url, { requestLabel: 'Landing overview', timeoutMs: requestTimeoutMs, retryCount: 0 })
                .then(function (res) {
                    var data = res && res.data;
                    if (data && data.ok) {
                        landingOverview = { rba: data.rba || null, feeds: data.feeds || null };
                        applyLandingOverview();
                    }
                })
                .catch(function () {})
            : fetch((window.AR.network && window.AR.network.appendCacheBust ? window.AR.network.appendCacheBust(url) : url), { cache: 'no-store' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (data && data.ok) {
                        landingOverview = { rba: data.rba || null, feeds: data.feeds || null };
                        applyLandingOverview();
                    }
                })
                .catch(function () {});
    }

    function loadHeroStats() {
        if (syncHeroStatsFromSnapshot()) return;
        loadOverview();
        if (!syncHeroStatsFromExplorer()) {
            clearHeroError();
        }
    }

    window.addEventListener('ar:explorer-state', function (event) {
        var detail = event && event.detail ? event.detail : {};
        if (detail.status === 'ready') {
            syncHeroStatsFromExplorer(detail);
            return;
        }
        if (detail.status === 'error') {
            if (heroStatsReady) {
                setInlineError(els.heroError, 'Overview metrics may be stale because the live table could not refresh.');
                return;
            }
            showHeroError();
            return;
        }
        if (detail.status === 'loading') {
            clearHeroError();
        }
    });

    function sortRows(rows) {
        var bestIsLowest = section === 'home-loans';
        return rows.slice().sort(function (a, b) {
            var aRate = Number(a && a.interest_rate);
            var bRate = Number(b && b.interest_rate);
            if (!Number.isFinite(aRate) && !Number.isFinite(bRate)) return 0;
            if (!Number.isFinite(aRate)) return 1;
            if (!Number.isFinite(bRate)) return -1;
            return bestIsLowest ? aRate - bRate : bRate - aRate;
        });
    }

    function compactProductName(productName, bankName) {
        var s = String(productName || '').trim();
        var bn = String(bankName || '').trim();
        if (bn && s.toLowerCase().indexOf(bn.toLowerCase()) === 0) {
            s = s.slice(bn.length).trim();
        }
        s = s.replace(/\s*\((?:owner\s*occupied|owner\s*occupier|investor|investment|P\s*&\s*I|interest\s*only)\s*\)\s*/gi, ' ');
        return s.replace(/\s+/g, ' ').trim() || productName || '-';
    }

    function shortRateStructure(rs) {
        var s = String(rs || '').trim();
        if (!s) return '';
        // Accepts: "fixed_1yr" / "fixed_3_year" / "fixed 1 year" / "1 year fixed".
        var m = s.match(/(?:fixed[_\s]*|^)(\d+)\s*(?:yr|year|yrs|years)/i);
        if (m) return m[1] + 'Y fixed';
        m = s.match(/^(\d+)\s*(?:yr|year|yrs|years)\s+fixed/i);
        if (m) return m[1] + 'Y fixed';
        if (/^variable$/i.test(s)) return 'Var';
        if (/^fixed$/i.test(s) || /^fixed_?term$/i.test(s)) return 'Fixed';
        return s;
    }

    function shortDetail(row) {
        if (!row) return '';
        if (section === 'home-loans') {
            var parts = [];
            if (/^owner/i.test(String(row.security_purpose || ''))) parts.push('OO');
            else if (/^investment/i.test(String(row.security_purpose || ''))) parts.push('Inv');
            if (/interest\s*only/i.test(String(row.repayment_type || ''))) parts.push('IO');
            else if (/principal/i.test(String(row.repayment_type || ''))) parts.push('P&I');
            var rsLabel = shortRateStructure(row.rate_structure);
            if (rsLabel) parts.push(rsLabel);
            if (row.lvr_tier) parts.push(String(row.lvr_tier).replace(/^lvr_/i, '').replace(/_/g, ' '));
            return parts.join(' \u00b7 ');
        }
        if (section === 'savings') {
            return [row.account_type, row.rate_type, row.deposit_tier].filter(Boolean).join(' \u00b7 ');
        }
        var tdParts = [];
        if (row.term_months) {
            var tm = Number(row.term_months);
            if (Number.isFinite(tm) && tm > 0) {
                tdParts.push(tm >= 12 && tm % 12 === 0 ? (tm / 12) + 'y' : tm + 'mo');
            }
        }
        if (row.deposit_tier) tdParts.push(row.deposit_tier);
        if (row.interest_payment) tdParts.push(row.interest_payment);
        return tdParts.filter(Boolean).join(' \u00b7 ');
    }

    function ladderCard(entry) {
        var row = entry && entry.row ? entry.row : entry;
        var scenarioLabel = entry && entry.scenarioLabel ? String(entry.scenarioLabel).trim() : '';
        var bankName = String(row && row.bank_name || '').trim() || '-';
        var bank = bankBrand && typeof bankBrand.badge === 'function'
            ? bankBrand.badge(bankName, { compact: true })
            : esc(bankName);
        var productRaw = row && row.product_name || (scenarioLabel ? 'No match' : '-');
        var product = esc(compactProductName(productRaw, bankName));
        var rate = row ? pct(row.interest_rate) : '-';
        var detail = esc(shortDetail(row) || scenarioLabel);

        var targetKey = '';
        if (row && row.product_key) targetKey = String(row.product_key);
        else if (row && (row.bank_name || row.product_name)) targetKey = (row.bank_name || '') + '|' + (row.product_name || '');

        return '' +
            '<article class="ladder-card" role="button" tabindex="0"' +
                ' data-bank="' + esc(bankName.toLowerCase()) + '"' +
                ' data-bank-name="' + esc(bankName) + '"' +
                ' data-product="' + product.toLowerCase() + '"' +
                ' data-product-name="' + esc(productRaw) + '"' +
                ' data-product-key="' + esc(targetKey) + '"' +
                ' data-scenario="' + esc(scenarioLabel.toLowerCase()) + '">' +
                '<div class="ladder-card-row">' +
                    '<strong class="ladder-rate">' + esc(rate) + '</strong>' +
                    '<span class="ladder-bank">' + bank + '</span>' +
                '</div>' +
                '<div class="ladder-card-row ladder-card-sub">' +
                    '<span class="ladder-product">' + product + '</span>' +
                    (detail ? '<span class="ladder-detail">' + detail + '</span>' : '') +
                '</div>' +
            '</article>';
    }

    function dispatchLadderClick(el) {
        if (!el) return;
        var detail = {
            bankName: el.getAttribute('data-bank-name') || '',
            productName: el.getAttribute('data-product-name') || '',
            productKey: el.getAttribute('data-product-key') || '',
            scenario: el.getAttribute('data-scenario') || '',
            section: section,
        };
        try {
            window.dispatchEvent(new CustomEvent('ar:leader-focus', { detail: detail }));
            clientLog('info', 'Leaders card click', {
                section: section,
                bank: String(detail.bankName).slice(0, 48),
                product: String(detail.productName).slice(0, 60),
            });
        } catch (_err) {}
    }

    function bindLadderCardClicks(container) {
        if (!container || container._arLadderBound) return;
        container._arLadderBound = true;
        container.addEventListener('click', function (ev) {
            var card = ev.target && ev.target.closest ? ev.target.closest('.ladder-card') : null;
            if (!card || !container.contains(card)) return;
            dispatchLadderClick(card);
        });
        container.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            var card = ev.target && ev.target.closest ? ev.target.closest('.ladder-card') : null;
            if (!card || !container.contains(card)) return;
            ev.preventDefault();
            dispatchLadderClick(card);
        });
    }

    function renderQuickCompareCards(rows) {
        if (!els.quickCompareCards) return;
        if (!rows.length) {
            els.quickCompareCards.innerHTML = '<p class="quick-empty">No leaders match this slice.</p>';
            return;
        }
        els.quickCompareCards.innerHTML = rows.map(ladderCard).join('');
        bindLadderCardClicks(els.quickCompareCards);
    }

    function applyLadderSearch() {
        if (!els.quickCompareCards) return;
        var needle = String(els.ladderSearch && els.ladderSearch.value || '').trim().toLowerCase();
        if (!needle) {
            renderQuickCompareCards(ladderRows);
            return;
        }
        renderQuickCompareCards(ladderRows.filter(function (row) {
            var source = row && row.row ? row.row : row;
            var bank = String(source && source.bank_name || '').toLowerCase();
            var product = String(source && source.product_name || '').toLowerCase();
            var scenario = String(row && row.scenarioLabel || '').toLowerCase();
            return bank.indexOf(needle) >= 0 || product.indexOf(needle) >= 0 || scenario.indexOf(needle) >= 0;
        }));
    }

    function getQuickCompareContext() {
        var snapshot = filters && typeof filters.getStateSnapshot === 'function'
            ? filters.getStateSnapshot()
            : null;
        return {
            activeCount: Number(snapshot && snapshot.activeCount || 0),
            params: buildFilterParams(),
        };
    }

    function rowMatchesParam(row, key, value) {
        var nextKey = String(key || '').trim();
        var nextValue = String(value == null ? '' : value).trim();
        if (!nextKey || !nextValue) return true;
        if (SNAPSHOT_IGNORE_PARAMS[nextKey]) return true;
        if (nextKey === 'min_rate') return Number(row && row.interest_rate) >= Number(nextValue);
        if (nextKey === 'max_rate') return Number(row && row.interest_rate) <= Number(nextValue);
        if (nextKey === 'min_comparison_rate') return Number(row && row.comparison_rate) >= Number(nextValue);
        if (nextKey === 'max_comparison_rate') return Number(row && row.comparison_rate) <= Number(nextValue);
        if (nextKey === 'bank') return String(row && row.bank_name || '').trim().toLowerCase() === nextValue.toLowerCase();
        if (nextKey === 'banks') {
            var allowed = nextValue.split(',').map(function (part) { return part.trim().toLowerCase(); }).filter(Boolean);
            if (!allowed.length) return true;
            return allowed.indexOf(String(row && row.bank_name || '').trim().toLowerCase()) >= 0;
        }
        return String(row && row[nextKey] || '').trim() === nextValue;
    }

    function filterSnapshotRows(rows, params) {
        return (Array.isArray(rows) ? rows : []).filter(function (row) {
            var keys = Object.keys(params || {});
            for (var i = 0; i < keys.length; i++) {
                if (!rowMatchesParam(row, keys[i], params[keys[i]])) return false;
            }
            return true;
        });
    }

    function loadHomeLoanScenarioRibbonFromSnapshot(baseParams, rows) {
        var entries = [];
        for (var i = 0; i < MORTGAGE_SAMPLE_SCENARIOS.length; i++) {
            var scenario = MORTGAGE_SAMPLE_SCENARIOS[i];
            var params = {};
            Object.keys(baseParams || {}).forEach(function (key) {
                params[key] = baseParams[key];
            });
            Object.keys(scenario.params).forEach(function (key) {
                params[key] = scenario.params[key];
            });
            var matches = sortRows(filterSnapshotRows(rows, params));
            if (!matches.length) return null;
            entries.push({
                scenarioLabel: scenario.label,
                row: matches[0] || null,
            });
        }
        return entries;
    }

    function loadQuickCompareFromSnapshot(context) {
        var currentLeaders = snapshotCurrentLeaders();
        if (section === 'home-loans' && context.activeCount === 0) {
            var scenarioLeaders = currentLeaders && Array.isArray(currentLeaders.scenarios) ? currentLeaders.scenarios : null;
            if (scenarioLeaders && scenarioLeaders.length) return scenarioLeaders;
        }
        if (context.activeCount === 0) {
            var defaultLeaders = currentLeaders && Array.isArray(currentLeaders.rows) ? currentLeaders.rows : null;
            if (defaultLeaders && defaultLeaders.length && section !== 'home-loans') return sortRows(defaultLeaders).slice(0, QUICK_COMPARE_LIMIT);
        }
        var rows = snapshotLatestAllRows();
        if (!rows.length) return null;
        if (section === 'home-loans' && context.activeCount === 0) {
            return loadHomeLoanScenarioRibbonFromSnapshot(context.params, rows);
        }
        var filtered = sortRows(filterSnapshotRows(rows, context.params));
        return filtered.length ? filtered.slice(0, QUICK_COMPARE_LIMIT) : null;
    }

    function buildLatestUrl(params) {
        return apiBase + '/latest?' + new URLSearchParams(params).toString();
    }

    async function requestLatestRows(params, requestLabel) {
        var url = buildLatestUrl(params);
        if (requestJson) {
            return (await requestJson(url, {
                requestLabel: requestLabel,
                timeoutMs: requestTimeoutMs,
                retryCount: 1,
                retryDelayMs: 700,
            })).data;
        }
        return await fetch((window.AR.network && window.AR.network.appendCacheBust ? window.AR.network.appendCacheBust(url) : url), { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status + ' for /latest');
            return response.json();
        });
    }

    async function loadHomeLoanScenarioRibbon(baseParams) {
        var requests = MORTGAGE_SAMPLE_SCENARIOS.map(function (scenario) {
            var params = {};
            Object.keys(baseParams || {}).forEach(function (key) {
                params[key] = baseParams[key];
            });
            Object.keys(scenario.params).forEach(function (key) {
                params[key] = scenario.params[key];
            });
            params.limit = '1';
            params.order_by = 'rate_asc';
            return requestLatestRows(params, 'Leaders rail: ' + scenario.label).then(function (data) {
                var rows = sortRows(Array.isArray(data && data.rows) ? data.rows : []);
                return {
                    scenarioLabel: scenario.label,
                    row: rows[0] || null,
                };
            });
        });
        return Promise.all(requests);
    }

    async function loadQuickCompare() {
        if (!els.quickCompareCards || !apiBase) {
            if (els.quickCompareCards && !apiBase) els.quickCompareCards.innerHTML = '<p class="quick-empty">Leaders unavailable right now.</p>';
            return;
        }
        var requestSeq = ++quickCompareRequestSeq;
        try {
            var context = getQuickCompareContext();
            var params = context.params;
            var snapshotRows = loadQuickCompareFromSnapshot(context);
            if (!snapshotRows) {
                var snapshot = window.AR && window.AR.snapshot;
                if (snapshot && typeof snapshot.awaitReady === 'function') {
                    await snapshot.awaitReady(1400);
                    snapshotRows = loadQuickCompareFromSnapshot(context);
                }
            }
            if (snapshotRows) {
                ladderRows = snapshotRows;
            } else if (section === 'home-loans' && context.activeCount === 0) {
                ladderRows = await loadHomeLoanScenarioRibbon(params);
            } else {
                params.limit = String(QUICK_COMPARE_LIMIT);
                params.order_by = section === 'home-loans' ? 'rate_asc' : 'rate_desc';
                var data = await requestLatestRows(params, 'Leaders rail');
                ladderRows = sortRows(Array.isArray(data && data.rows) ? data.rows : []);
            }
            if (requestSeq !== quickCompareRequestSeq) return;
            applyLadderSearch();
            if (ladderRows.length > 0) {
                var leadEntry = ladderRows[0];
                var lead = leadEntry && leadEntry.row ? leadEntry.row : leadEntry;
                if (lead) {
                    var leadBank = bankBrand && typeof bankBrand.shortLabel === 'function'
                        ? bankBrand.shortLabel(lead.bank_name)
                        : String(lead.bank_name || '').trim();
                    var leadNote = section === 'home-loans' && leadEntry && leadEntry.scenarioLabel
                        ? leadEntry.scenarioLabel + ': ' + (leadBank || 'Current leader')
                        : (leadBank || 'Current leader') + ' in the active slice.';
                    setIntroMetric('leader', pct(lead.interest_rate), leadNote);
                }
            }
        } catch (err) {
            clientLog('error', 'Quick compare load failed', {
                message: describeError(err, 'Leaders rail is temporarily unavailable.'),
            });
            if (els.quickCompareCards) els.quickCompareCards.innerHTML = '<p class="quick-empty">Leaders unavailable right now.</p>';
        }
    }

    if (els.ladderSearch) {
        els.ladderSearch.addEventListener('input', applyLadderSearch);
    }

    window.AR.hero = {
        loadHeroStats: loadHeroStats,
        loadQuickCompare: loadQuickCompare,
    };
})();
