import { request as requestHttp } from 'http';
import { request as requestHttps } from 'https';
import type { LookupAddress } from 'dns';
import { lookup } from 'dns/promises';
import { isIP, LookupFunction } from 'net';

export interface SafePostJsonOptions {
  timeoutMs: number;
  maxResponseBytes: number;
  blockPrivateNetworks: boolean;
}

export interface SafePostJsonResult {
  statusCode: number;
  body: string;
}

interface SafeTarget {
  url: URL;
  address?: string;
  family?: number;
}

class DeliveryTimeoutError extends Error {}

export async function safePostJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options: SafePostJsonOptions,
): Promise<SafePostJsonResult> {
  const target = await resolveSafeTarget(url, options.blockPrivateNetworks);
  const requestHeaders = sanitizeHeaders(headers);
  const serializedBody = JSON.stringify(body) ?? 'null';

  if (!hasHeader(requestHeaders, 'content-type')) {
    requestHeaders['content-type'] = 'application/json';
  }
  requestHeaders['content-length'] = String(Buffer.byteLength(serializedBody));

  try {
    return await postJson(target, serializedBody, requestHeaders, options);
  } catch (error) {
    if (error instanceof DeliveryTimeoutError) {
      throw new Error(
        `Delivery provider timed out after ${options.timeoutMs}ms`,
      );
    }

    throw error;
  }
}

async function resolveSafeTarget(
  url: string,
  blockPrivateNetworks: boolean,
): Promise<SafeTarget> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Delivery URL must be a valid URL');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Delivery URL protocol must be http or https');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Delivery URL credentials are not allowed');
  }

  if (!blockPrivateNetworks) {
    return { url: parsedUrl };
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Delivery URL cannot target localhost');
  }

  const addresses =
    isIP(hostname) === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: isIP(hostname) }];

  if (addresses.length === 0) {
    throw new Error('Delivery URL hostname did not resolve to an address');
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error('Delivery URL cannot target private or local networks');
    }
  }

  // Pin the request to an address from this validated DNS response. Allowing the
  // HTTP client to resolve the hostname again would leave a DNS-rebinding gap.
  return {
    url: parsedUrl,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

function postJson(
  target: SafeTarget,
  body: string,
  headers: Record<string, string>,
  options: SafePostJsonOptions,
) {
  return new Promise<SafePostJsonResult>((resolve, reject) => {
    let settled = false;
    const succeed = (result: SafePostJsonResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    const request = (
      target.url.protocol === 'https:' ? requestHttps : requestHttp
    )(
      target.url,
      {
        method: 'POST',
        headers,
        ...(target.address
          ? { lookup: pinnedLookup(target.address, target.family!) }
          : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on('data', (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.byteLength;
          if (totalBytes > options.maxResponseBytes) {
            response.destroy();
            fail(
              new Error(
                `Delivery provider response exceeded ${options.maxResponseBytes} bytes`,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on('error', fail);
        response.on('end', () => {
          if (settled) return;

          const statusCode = response.statusCode ?? 0;
          const responseBody = Buffer.concat(chunks).toString('utf8');
          if (statusCode >= 300 && statusCode < 400) {
            fail(
              new Error(
                `Delivery provider redirect was blocked: ${statusCode}`,
              ),
            );
            return;
          }
          if (statusCode < 200 || statusCode >= 300) {
            fail(
              new Error(
                `Delivery provider responded with ${statusCode}: ${responseBody.slice(0, 500)}`,
              ),
            );
            return;
          }

          succeed({ statusCode, body: responseBody });
        });
      },
    );

    const timeout = setTimeout(() => {
      request.destroy(new DeliveryTimeoutError());
    }, options.timeoutMs);
    request.on('error', fail);
    request.end(body);
  });
}

function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all) {
      const callbackAll = callback as (
        error: NodeJS.ErrnoException | null,
        addresses: LookupAddress[],
      ) => void;
      callbackAll(null, [{ address, family }]);
      return;
    }

    const callbackOne = callback as (
      error: NodeJS.ErrnoException | null,
      address: string,
      family: number,
    ) => void;
    callbackOne(null, address, family);
  };
}

function sanitizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        !['host', 'connection', 'content-length', 'transfer-encoding'].includes(
          key.toLowerCase(),
        ),
    ),
  );
}

function hasHeader(headers: Record<string, string>, name: string) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function normalizeHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

function isPrivateAddress(address: string) {
  const addressFamily = isIP(address);

  if (addressFamily === 0) {
    return true;
  }

  if (addressFamily === 4) {
    return isIPv4Private(address);
  }

  return isIPv6Private(address);
}

function isIPv4Private(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && parts[2] === 100) ||
    (first === 203 && second === 0 && parts[2] === 113)
  );
}

function isIPv6Private(address: string) {
  const normalized = address.toLowerCase();
  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    normalized.startsWith('2001:db8:')
  );
}
