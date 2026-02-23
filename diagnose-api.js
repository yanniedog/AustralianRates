/**
 * API Endpoint Diagnostic Script
 *
 * Tests the Australian Rates API endpoints to identify connectivity issues.
 * Run with: node diagnose-api.js
 * Optional: API_BASE or TEST_URL env (e.g. TEST_URL=https://www.example.com/ => API_BASE=https://www.example.com/api/home-loan-rates)
 */

const https = require('https');

function getApiBase() {
    if (process.env.API_BASE) return process.env.API_BASE.replace(/\/+$/, '');
    const testUrl = process.env.TEST_URL || 'https://www.australianrates.com/';
    const origin = new URL(testUrl).origin;
    return origin + '/api/home-loan-rates';
}

function getHomepageUrl() {
    if (process.env.TEST_URL) return new URL(process.env.TEST_URL).origin + '/';
    return 'https://www.australianrates.com/';
}

const API_BASE = getApiBase();

function testEndpoint(urlStr, description, options = {}) {
    const expectCsv = options.expectCsv === true;
    const expectHtml = options.expectHtml === true;
    return new Promise((resolve) => {
        console.log(`\nTesting: ${description}`);
        console.log(`URL: ${urlStr}`);
        
        const startTime = Date.now();
        
        https.get(urlStr, (res) => {
            const duration = Date.now() - startTime;
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`  Status: ${res.statusCode}`);
                console.log(`  Duration: ${duration}ms`);
                console.log(`  Content-Length: ${data.length} bytes`);
                
                if (res.statusCode !== 200) {
                    if (res.statusCode === 400 && description.toLowerCase().includes('timeseries')) {
                        console.log(`  ✓ Timeseries endpoint reachable (400: requires product_key)`);
                        resolve({ success: true, status: res.statusCode, duration, data: data });
                        return;
                    }
                    console.log(`  ✗ Non-200 status code`);
                    console.log(`  Response: ${data.substring(0, 200)}`);
                    resolve({ success: false, status: res.statusCode, duration, data: data });
                    return;
                }
                
                if (expectHtml) {
                    const isHtml = data.toLowerCase().includes('<!doctype') || data.toLowerCase().includes('<html');
                    if (res.statusCode === 200 && isHtml) {
                        console.log(`  ✓ HTML response (${data.length} bytes)`);
                        resolve({ success: true, status: res.statusCode, duration, data: data });
                    } else {
                        resolve({ success: false, status: res.statusCode, duration, error: 'Expected HTML' });
                    }
                    return;
                }
                
                if (expectCsv) {
                    const firstLine = data.split('\n')[0] || '';
                    const hasHeader = firstLine.includes('collection_date') || firstLine.includes('bank_name') || firstLine.includes('interest_rate');
                    if (hasHeader || data.length > 100) {
                        console.log(`  ✓ CSV response (first line length: ${firstLine.length})`);
                        resolve({ success: true, status: res.statusCode, duration, data: data });
                    } else {
                        console.log(`  ✗ CSV header not found. First line: ${firstLine.substring(0, 120)}`);
                        resolve({ success: false, status: res.statusCode, duration, error: 'Invalid CSV structure' });
                    }
                    return;
                }
                
                try {
                    const json = JSON.parse(data);
                    console.log(`  ✓ Valid JSON response`);
                    
                    if (description.includes('health')) {
                        const ok = json.ok === true || json.status === 'ok' || (typeof json.healthy !== 'undefined');
                        if (ok) console.log(`  Health: ok`);
                        else console.log(`  Health payload: ${JSON.stringify(json).substring(0, 100)}`);
                    } else if (description.includes('filters')) {
                        console.log(`  Banks count: ${json.filters?.banks?.length ?? json.banks?.length ?? 0}`);
                    } else if (description.includes('rates')) {
                        console.log(`  Total records: ${json.total || 0}`);
                        console.log(`  Data rows: ${json.data?.length || 0}`);
                        if (json.data && json.data.length > 0) {
                            console.log(`  First row sample:`, {
                                date: json.data[0].collection_date,
                                bank: json.data[0].bank_name,
                                rate: json.data[0].interest_rate,
                                cash_rate: json.data[0].rba_cash_rate
                            });
                        }
                    } else if (description.includes('latest')) {
                        const hasData = Array.isArray(json.data) || (json.data && typeof json.data === 'object');
                        console.log(`  Latest data: ${hasData ? 'present' : 'missing'}`);
                    } else if (description.includes('timeseries')) {
                        const hasSeries = Array.isArray(json.data) || Array.isArray(json.series);
                        console.log(`  Timeseries: ${hasSeries ? 'present' : 'missing'}`);
                    }
                    
                    resolve({ success: true, status: res.statusCode, duration, data: json });
                } catch (e) {
                    console.log(`  ✗ Invalid JSON: ${e.message}`);
                    console.log(`  First 200 chars: ${data.substring(0, 200)}`);
                    resolve({ success: false, status: res.statusCode, duration, error: 'Invalid JSON' });
                }
            });
        }).on('error', (err) => {
            const duration = Date.now() - startTime;
            console.log(`  ✗ Request failed: ${err.message}`);
            resolve({ success: false, duration, error: err.message });
        });
    });
}

async function runDiagnostics() {
    console.log('========================================');
    console.log('Australian Rates API Diagnostics');
    console.log('========================================');
    console.log(`Base URL: ${API_BASE}`);
    console.log(`Test Time: ${new Date().toISOString()}`);
    
    const homepageUrl = getHomepageUrl();
    
    const tests = [
        { url: `${API_BASE}/health`, description: 'Health endpoint' },
        { url: `${API_BASE}/filters`, description: 'Filters endpoint (bank names, etc.)' },
        { url: `${API_BASE}/rates?page=1&size=1&sort=collection_date&dir=desc`, description: 'Latest rate (for hero stats)' },
        { url: `${API_BASE}/rates?page=1&size=50`, description: 'Rate Explorer table data (50 rows)' },
        { url: `${API_BASE}/latest`, description: 'Latest rates endpoint' },
        { url: `${API_BASE}/timeseries`, description: 'Timeseries endpoint' },
        { url: `${API_BASE}/export.csv`, description: 'Export CSV endpoint', expectCsv: true },
        { url: homepageUrl, description: 'Homepage HTML', expectHtml: true }
    ];
    
    const results = [];
    
    for (const test of tests) {
        const result = await testEndpoint(test.url, test.description, { expectCsv: test.expectCsv, expectHtml: test.expectHtml });
        results.push({ ...test, ...result });
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`\nSuccessful: ${successful.length}/${results.length}`);
    if (successful.length > 0) {
        successful.forEach(r => {
            console.log(`  ✓ ${r.description} (${r.status}, ${r.duration}ms)`);
        });
    }
    
    if (failed.length > 0) {
        console.log(`\nFailed: ${failed.length}/${results.length}`);
        failed.forEach(r => {
            console.log(`  ✗ ${r.description}`);
            if (r.status) console.log(`    Status: ${r.status}`);
            if (r.error) console.log(`    Error: ${r.error}`);
        });
    }
    
    // Recommendations
    console.log('\n========================================');
    console.log('RECOMMENDATIONS');
    console.log('========================================\n');
    
    if (failed.length === 0) {
        console.log('✓ All API endpoints are working correctly!');
        console.log('  The homepage test failures may be due to timing issues.');
        console.log('  Try increasing wait times in test-homepage.js');
    } else {
        const apiEndpointsFailed = failed.some(r => r.url.includes('/api/'));
        const homepageFailed = failed.some(r => r.description === 'Homepage HTML');
        
        if (homepageFailed) {
            console.log('✗ Homepage not accessible');
            console.log('  - Check DNS resolution');
            console.log('  - Verify website is deployed');
            console.log('  - Check Cloudflare Pages status');
        }
        
        if (apiEndpointsFailed) {
            console.log('✗ API endpoints not working');
            console.log('  - Check Cloudflare Workers deployment');
            console.log('  - Verify API routes are configured');
            console.log('  - Check database connectivity');
            console.log('  - Review Cloudflare Workers logs');
            console.log('  - Verify environment variables');
        }
        
        const notFoundErrors = failed.filter(r => r.status === 404);
        if (notFoundErrors.length > 0) {
            console.log('\n✗ 404 Not Found errors detected');
            console.log('  - Check routing configuration');
            console.log('  - Verify URL paths are correct');
            console.log('  - Confirm workers are bound to routes');
        }
        
        const serverErrors = failed.filter(r => r.status >= 500);
        if (serverErrors.length > 0) {
            console.log('\n✗ Server errors (5xx) detected');
            console.log('  - Check Cloudflare Workers logs');
            console.log('  - Verify database is running');
            console.log('  - Check for runtime errors in worker code');
        }
    }
    
    console.log('\n========================================\n');
    
    // Exit code
    process.exit(failed.length > 0 ? 1 : 0);
}

// Run diagnostics
runDiagnostics().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
