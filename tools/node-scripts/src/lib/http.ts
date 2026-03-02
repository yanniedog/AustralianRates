import https from 'node:https';

export async function httpsGetJson<T = any>(host: string, path: string, headers?: Record<string, string>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(data || String(res.statusCode)));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
