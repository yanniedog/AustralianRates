(function () {
    'use strict';
    window.AR = window.AR || {};

    /**
     * True when a snapshot `latestAll` block covers the requested limit (or full universe).
     * Rejects capped inline/API snapshots where total exceeds returned rows.
     */
    function latestAllBlockIsCompleteForLimit(block, requestedLimit) {
        if (!block || typeof block !== 'object' || !Array.isArray(block.rows)) return false;
        var rows = block.rows;
        var limit = Math.max(0, Number(requestedLimit || 0));
        var count = Number(block.count);
        var total = Number(block.total);
        var meta = block.meta && typeof block.meta === 'object' ? block.meta : null;
        var coverage = meta && meta.coverage && typeof meta.coverage === 'object' ? meta.coverage : null;
        var coverageTotal = coverage ? Number(coverage.total_rows) : NaN;
        var coverageLimited = !!(coverage && coverage.limited);
        var snapshotTruncated = !!(meta && meta.snapshot_rows_truncated);
        var knownTotal = Number.isFinite(total)
            ? total
            : Number.isFinite(coverageTotal)
                ? coverageTotal
                : Number.isFinite(count)
                    ? count
                    : rows.length;
        if (!rows.length) return knownTotal === 0;
        if (knownTotal > rows.length) return false;
        if (limit > 0 && rows.length < Math.min(limit, knownTotal)) return false;
        if ((coverageLimited || snapshotTruncated) && limit > 0 && rows.length < limit) return false;
        return true;
    }

    window.AR.latestAllCompleteness = {
        latestAllBlockIsCompleteForLimit: latestAllBlockIsCompleteForLimit,
    };
})();
