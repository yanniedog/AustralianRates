import https from 'node:https';

export interface CloudflareApiOptions {
  token: string;
  method: string;
  path: string;
  body?: unknown;
}

function toApiErrorMessage(json: any, raw: string, statusCode: number | undefined): string {
  const err = json?.errors?.[0];
  if (err && typeof err.message === 'string') {
    const suffix = err.code ? ` (code ${err.code})` : '';
    return `${err.message}${suffix}`;
  }
  if (typeof raw === 'string' && raw.trim()) return raw;
  return String(statusCode || 'API error');
}

export async function requestCloudflareJson<T = any>(input: CloudflareApiOptions): Promise<T> {
  const { token, method, path, body } = input;
  return await new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.cloudflare.com',
        path: '/client/v4' + path,
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json?.success === false) {
              reject(new Error(toApiErrorMessage(json, data, res.statusCode)));
              return;
            }
            resolve(json as T);
          } catch {
            reject(new Error(data || String(res.statusCode)));
          }
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}
