(function () {
    'use strict';

    function byId(id) {
        return document.getElementById(id);
    }

    function parsePositiveNumber(value) {
        var normalized = String(value == null ? '' : value).replace(/,/g, '').trim();
        if (!normalized) return null;
        var n = Number(normalized);
        if (!Number.isFinite(n) || n < 0) return null;
        return n;
    }

    function formatMoney(value) {
        if (!Number.isFinite(value)) return '-';
        return new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }

    function computeMonthlyPayment(principal, annualRatePct, termYears, repaymentType) {
        var months = Math.max(1, Math.floor(termYears * 12));
        var monthlyRate = (annualRatePct / 100) / 12;

        if (repaymentType === 'interest_only') {
            return principal * monthlyRate;
        }
        if (monthlyRate === 0) {
            return principal / months;
        }

        var factor = Math.pow(1 + monthlyRate, months);
        return principal * ((monthlyRate * factor) / (factor - 1));
    }

    function initCalculator() {
        var principalInput = byId('calc-loan-amount');
        var rateInput = byId('calc-interest-rate');
        var termInput = byId('calc-term-years');
        var typeInput = byId('calc-repayment-type');
        var runBtn = byId('calc-run');
        var output = byId('calc-result');

        if (!principalInput || !rateInput || !termInput || !typeInput || !runBtn || !output) return;

        function renderError(message) {
            output.innerHTML = '<strong>Estimate:</strong> ' + message;
        }

        function runEstimate() {
            var principal = parsePositiveNumber(principalInput.value);
            var annualRate = parsePositiveNumber(rateInput.value);
            var termYears = parsePositiveNumber(termInput.value);
            var repaymentType = String(typeInput.value || 'principal_and_interest');

            if (principal == null || principal <= 0) {
                renderError('Enter a valid loan amount greater than 0.');
                return;
            }
            if (annualRate == null || annualRate < 0) {
                renderError('Enter a valid annual rate (0 or greater).');
                return;
            }
            if (termYears == null || termYears < 1) {
                renderError('Enter a loan term of at least 1 year.');
                return;
            }

            var monthly = computeMonthlyPayment(principal, annualRate, termYears, repaymentType);
            var typeLabel = repaymentType === 'interest_only' ? 'Interest Only' : 'Principal & Interest';
            output.innerHTML = '<strong>Estimated monthly repayment:</strong> ' + formatMoney(monthly) + ' <span class="hint">(' + typeLabel + ')</span>';
        }

        runBtn.addEventListener('click', runEstimate);
        principalInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runEstimate(); });
        rateInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runEstimate(); });
        termInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runEstimate(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCalculator);
    } else {
        initCalculator();
    }
})();
