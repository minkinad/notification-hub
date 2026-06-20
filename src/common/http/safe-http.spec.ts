import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { safePostJson } from './safe-http';

const defaultOptions = {
  timeoutMs: 1000,
  maxResponseBytes: 1024,
  blockPrivateNetworks: false,
};

describe('safePostJson', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it('posts JSON and replaces unsafe transport headers', async () => {
    let receivedBody = '';
    let receivedHost = '';
    let receivedLength = '';
    server = createServer((request, response) => {
      receivedHost = request.headers.host ?? '';
      receivedLength = request.headers['content-length'] ?? '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (receivedBody += chunk));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"accepted":true}');
      });
    });
    const url = await listen(server);

    const result = await safePostJson(
      url,
      { message: 'Привет' },
      { Host: 'attacker.invalid', 'Content-Length': '1' },
      defaultOptions,
    );

    expect(result).toEqual({
      statusCode: 200,
      body: '{"accepted":true}',
    });
    expect(receivedBody).toBe('{"message":"Привет"}');
    expect(receivedHost).toMatch(/^127\.0\.0\.1:/);
    expect(receivedLength).toBe(String(Buffer.byteLength(receivedBody)));
  });

  it.each([
    'http://127.0.0.1/webhook',
    'http://169.254.169.254/latest/meta-data',
    'http://192.0.2.1/webhook',
    'http://198.18.0.1/webhook',
    'http://[fe90::1]/webhook',
  ])('blocks non-public target %s', async (url) => {
    await expect(
      safePostJson(
        url,
        {},
        {},
        { ...defaultOptions, blockPrivateNetworks: true },
      ),
    ).rejects.toThrow('private or local networks');
  });

  it('rejects redirects without following them', async () => {
    server = createServer((_, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1/private' });
      response.end();
    });
    const url = await listen(server);

    await expect(safePostJson(url, {}, {}, defaultOptions)).rejects.toThrow(
      'redirect was blocked: 302',
    );
  });

  it('stops reading oversized responses', async () => {
    server = createServer((_, response) => {
      response.writeHead(200);
      response.end('response-is-too-large');
    });
    const url = await listen(server);

    await expect(
      safePostJson(url, {}, {}, { ...defaultOptions, maxResponseBytes: 4 }),
    ).rejects.toThrow('response exceeded 4 bytes');
  });

  it('enforces a total request timeout', async () => {
    server = createServer(() => undefined);
    const url = await listen(server);

    await expect(
      safePostJson(url, {}, {}, { ...defaultOptions, timeoutMs: 20 }),
    ).rejects.toThrow('timed out after 20ms');
  });
});

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/webhook`;
}
