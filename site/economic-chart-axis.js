(function () {
    'use strict';

    window.AR = window.AR || {};

    function createChartAxis(deps) {
        var state = deps.state;
        var refs = deps.refs;
        var persistYScale = deps.persistYScale;
        var logEvent = deps.logEvent;

        function minPositiveNormalized(seriesList) {
            var min = Infinity;
            (seriesList || []).forEach(function (series) {
                (series.points || []).forEach(function (point) {
                    var value = point && point.normalized_value;
                    if (value != null && isFinite(value) && value > 0 && value < min) min = value;
                });
            });
            return min === Infinity ? null : min;
        }

        function normalizedSeriesHasNonPositive(seriesList) {
            return (seriesList || []).some(function (series) {
                return (series.points || []).some(function (point) {
                    var value = point && point.normalized_value;
                    return value != null && isFinite(value) && value <= 0;
                });
            });
        }

        function normalizedExtent(seriesList) {
            return valueExtent(seriesList, 'normalized_value');
        }

        function valueExtent(seriesList, fieldName) {
            var min = Infinity;
            var max = -Infinity;
            (seriesList || []).forEach(function (series) {
                (series.points || []).forEach(function (point) {
                    var value = Number(point && point[fieldName]);
                    if (!Number.isFinite(value)) return;
                    if (value < min) min = value;
                    if (value > max) max = value;
                });
            });
            if (min === Infinity || max === -Infinity) return null;
            return { min: min, max: max };
        }

        function buildAutoFitYAxis(type, extent, minPositive) {
            if (!extent) return null;
            var min = Number(extent.min);
            var max = Number(extent.max);
            if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

            if (type === 'log') {
                var safeMin = Number.isFinite(minPositive) && minPositive > 0 ? minPositive : min;
                var safeMax = max > 0 ? max : safeMin;
                if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMin <= 0 || safeMax <= 0) return null;
                if (safeMax < safeMin) safeMax = safeMin;
                if (safeMax === safeMin) {
                    return {
                        min: safeMin / 1.35,
                        max: safeMax * 1.35,
                    };
                }
                return {
                    min: safeMin / 1.12,
                    max: safeMax * 1.12,
                };
            }

            var span = max - min;
            if (!(span > 0)) {
                var center = min;
                var delta = Math.max(Math.abs(center) * 0.04, 1);
                return {
                    min: center - delta,
                    max: center + delta,
                };
            }
            var pad = span * 0.08;
            return {
                min: min - pad,
                max: max + pad,
            };
        }

        function syncYScaleButton(opt) {
            if (!refs.yScaleBtn) return;
            var rawMode = state.chartMode === 'raw';
            var effective = opt && opt.effectiveYAxis;
            var requestedLog = state.yScale === 'log';
            var actualLog = !rawMode && (effective === 'log' || (!effective && requestedLog));
            refs.yScaleBtn.textContent = actualLog ? 'log' : 'lin';
            refs.yScaleBtn.setAttribute('aria-pressed', actualLog ? 'true' : 'false');
            refs.yScaleBtn.disabled = rawMode;
            var forcedLinear = !rawMode && requestedLog && effective === 'value';
            refs.yScaleBtn.classList.toggle('is-forced-linear', forcedLinear);
            if (rawMode) {
                refs.yScaleBtn.title = 'Raw values always use a linear axis because selected indicators can use different units.';
            } else if (forcedLinear) {
                refs.yScaleBtn.title = 'Log scale is selected, but the chart uses linear because some series have zero or negative index values in this range.';
            } else if (actualLog) {
                refs.yScaleBtn.title = 'Y-axis: logarithmic (base 10). Click for linear scale.';
            } else {
                refs.yScaleBtn.title = 'Y-axis: linear. Click for logarithmic scale.';
            }
            refs.yScaleBtn.setAttribute(
                'aria-label',
                rawMode
                    ? 'Raw values use a linear Y-axis.'
                    : (forcedLinear
                    ? 'Chart uses a linear Y-axis; log scale is unavailable for the current data. Click to confirm linear preference.'
                    : (actualLog ? 'Y-axis logarithmic. Click for linear.' : 'Y-axis linear. Click for logarithmic.'))
            );
            if (refs.yScaleNote) {
                refs.yScaleNote.textContent = rawMode
                    ? 'Raw values: linear axis, native units.'
                    : (forcedLinear
                    ? 'Log unavailable for the current selection because at least one indexed series reaches zero or below in this range.'
                    : (actualLog ? 'Log scale active.' : 'Linear scale active.'));
            }
        }

        function toggleYScale() {
            if (state.chartMode === 'raw') return false;
            state.yScale = state.yScale === 'log' ? 'linear' : 'log';
            persistYScale(state.yScale);
            logEvent('info', 'Economic y-axis scale changed', { yScale: state.yScale });
            return true;
        }

        return {
            minPositiveNormalized: minPositiveNormalized,
            normalizedSeriesHasNonPositive: normalizedSeriesHasNonPositive,
            normalizedExtent: normalizedExtent,
            valueExtent: valueExtent,
            buildAutoFitYAxis: buildAutoFitYAxis,
            syncYScaleButton: syncYScaleButton,
            toggleYScale: toggleYScale
        };
    }

    window.AR.economicChartAxis = { create: createChartAxis };
})();
