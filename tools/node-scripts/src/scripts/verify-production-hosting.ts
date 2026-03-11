import dns from 'node:dns/promises';
import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';

const HOSTS = ['www.australianrates.com', 'australianrates.com'];
const API_PATHS = ['/', '/api/home-loan-rates/health', '/api/savings-rates/health', '/api/term-deposit-rates/health'];
const RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const DNS_TIMEOUT_MS = Math.max(1000, Number(process.env.PROD_VERIFY_DNS_TIMEOUT_MS || 5000));

type DnsResult = { resolver: string; ok: boolean; addresses?: string[]; error?: string; advisory?: boolean };

async function resolveWithTimeout(resolver: Resolver, host: string): Promise<string[]> {
  return await Promise.race([
    resolver.resolve4(host),
    new Promise<string[]>((_, reject) => {
      setTimeout(() => reject(new Error(`queryA ETIMEOUT ${host}`)), DNS_TIMEOUT_MS);
    }),
  ]);
}

function isNetworkPathError(error: string | undefined): boolean {
  const normalized = String(error || '').toUpperCase();
  return (
    normalized.includes('ETIMEOUT') ||
    normalized.includes('ETIMEDOUT') ||
    normalized.includes('ECONNREFUSED') ||
    normalized.includes('EHOSTUNREACH') ||
    normalized.includes('ENETUNREACH')
  );
}

async function resolveWithSystemDns(host: string): Promise<DnsResult> {
  try {
    const records = await dns.lookup(host, { all: true });
    return {
      resolver: 'system',
      ok: records.length > 0,
      addresses: records.map((record) => record.address),
    };
  } catch (error) {
    return { resolver: 'system', ok: false, error: String((error as Error)?.message || error) };
  }
}

async function resolveHost(host: string): Promise<DnsResult[]> {
  const results: Array<{ resolver: string; ok: boolean; addresses?: string[]; error?: string }> = [];
  for (const server of RESOLVERS) {
    const resolver = new Resolver();
    resolver.setServers([server]);
    try {
      const addresses = await resolveWithTimeout(resolver, host);
      results.push({ resolver: server, ok: true, addresses });
    } catch (error) {
      results.push({ resolver: server, ok: false, error: String((error as Error)?.message || error) });
    }
  }
  return results;
}

async function verifyTls(host: string): Promise<any> {
  return await new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
      },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          ok: socket.authorized,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || null,
          subject: cert?.subject?.CN || null,
          issuer: cert?.issuer?.CN || null,
        });
        socket.end();
      },
    );
    socket.setTimeout(15000, () => {
      resolve({ ok: false, authorized: false, authorizationError: 'tls_timeout' });
      socket.destroy();
    });
    socket.on('error', (error) => {
      resolve({ ok: false, authorized: false, authorizationError: String((error as Error)?.message || error) });
    });
  });
}

async function fetchUrl(url: string): Promise<any> {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'australianrates-prod-verifier/1.0' },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, url: response.url, snippet: text.slice(0, 160) };
  } catch (error) {
    return { ok: false, status: 0, url, error: String((error as Error)?.message || error) };
  }
}

async function main(): Promise<void> {
  const summary: any[] = [];
  let failed = false;

  for (const host of HOSTS) {
    const systemDns = await resolveWithSystemDns(host);
    const dns = await resolveHost(host);
    const tlsCheck = await verifyTls(host);
    const fetches: any[] = [];
    for (const apiPath of API_PATHS) {
      fetches.push(await fetchUrl(`https://${host}${apiPath}`));
    }

    const publicDnsFailed = dns.some((item) => !item.ok);
    const publicDnsNetworkOnly = publicDnsFailed && dns.every((item) => item.ok || isNetworkPathError(item.error));
    const hasEdgeProof = systemDns.ok && tlsCheck.ok && fetches.every((item) => item.ok);
    const normalizedDns = dns.map((item) => ({
      ...item,
      advisory: !item.ok && publicDnsNetworkOnly && hasEdgeProof,
    }));
    const publicDnsIsBlocking = publicDnsFailed && !(publicDnsNetworkOnly && hasEdgeProof);
    const hostFailed = !systemDns.ok || !tlsCheck.ok || fetches.some((item) => !item.ok) || publicDnsIsBlocking;
    failed ||= hostFailed;
    summary.push({ host, dns: normalizedDns, system_dns: systemDns, tls: tlsCheck, fetches });
  }

  console.log(JSON.stringify({ ok: !failed, checked_at: new Date().toISOString(), summary }, null, 2));
  if (failed) {
    const tlsFailed = summary.some((s) => !s.tls?.ok);
    if (tlsFailed) {
      console.error(
        '\nNote: TLS failed from this host. The site may still work in a browser or from another network (e.g. corporate proxy or local TLS stack can cause this). In Cloudflare dashboard set SSL/TLS -> Edge Certificates -> Minimum TLS Version to 1.2.',
      );
    }
    process.exitCode = 1;
  }
}

void main();
