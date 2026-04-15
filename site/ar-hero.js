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

    function syncPublicIntro() {
        publicIntro = window.AR.publicIntro || publicIntro;
        return publicIntro;
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

    function syncHeroStatsFromExplorer(snapshot) {
        var currentExplorer = window.AR.explorer || {};
        var state = snapshot && typeof snapshot === 'object'
            ? snapshot
            : (currentExplorer && typeof currentExplorer.getExplorerState === 'function' ? currentExplorer.getExplorerState() : null);
        if (!state || state.status !== 'ready') return false;
        return applyHeroSnapshot(state.total, state.latestRow);
    }

    function loadOverview() {
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

    function ladderCard(entry) {
        var row = entry && entry.row ? entry.row : entry;
        var scenarioLabel = entry && entry.scenarioLabel ? String(entry.scenarioLabel).trim() : '';
        var bankName = String(row && row.bank_name || '').trim() || '-';
        var bank = bankBrand && typeof bankBrand.badge === 'function'
            ? bankBrand.badge(bankName, { compact: true })
            : esc(bankName);
        var product = esc(row && row.product_name || (scenarioLabel ? 'No current match' : '-'));
        var rate = row ? pct(row.interest_rate) : 'Unavailable';
        var detail = section === 'home-loans'
            ? [row && row.security_purpose, row && row.repayment_type, row && row.rate_structure, row && row.lvr_tier].filter(Boolean).join(' | ')
            : section === 'savings'
                ? [row && row.account_type, row && row.rate_type, row && row.deposit_tier].filter(Boolean).join(' | ')
                : [row && row.term_months ? row.term_months + 'm' : '', row && row.deposit_tier, row && row.interest_payment].filter(Boolean).join(' | ');

        return '' +
            '<article class="ladder-card" data-bank="' + esc(bankName.toLowerCase()) + '" data-product="' + product.toLowerCase() + '" data-scenario="' + esc(scenarioLabel.toLowerCase()) + '">' +
                (scenarioLabel ? '<div class="ladder-card-meta"><span class="ladder-scenario">' + esc(scenarioLabel) + '</span></div>' : '') +
                '<div class="ladder-card-top">' +
                    '<strong class="ladder-rate">' + esc(rate) + '</strong>' +
                    '<span class="ladder-bank">' + bank + '</span>' +
                '</div>' +
                '<div class="ladder-card-bottom">' +
                    '<span class="ladder-product">' + product + '</span>' +
                    '<span class="ladder-detail">' + esc(detail || (scenarioLabel && !row ? 'No matching product in the current snapshot.' : '-')) + '</span>' +
                '</div>' +
            '</article>';
    }

    function renderQuickCompareCards(rows) {
        if (!els.quickCompareCards) return;
        if (!rows.length) {
            els.quickCompareCards.innerHTML = '<p class="quick-empty">No leaders match this slice.</p>';
            return;
        }
        els.quickCompareCards.innerHTML = rows.map(ladderCard).join('');
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
            if (section === 'home-loans' && context.activeCount === 0) {
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
