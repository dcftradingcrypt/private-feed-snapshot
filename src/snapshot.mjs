export const MAX_BYTES = 1_048_576;

const MAX_URL_LENGTH = 4096;
const RECEIPT_KEYS = [
  'schemaVersion', 'sha256', 'byteLength', 'requestedUrl', 'receivedAt',
  'status', 'contentType', 'transport', 'evidenceDisclaimer',
];
const TRANSPORT = { kind: 'nym-mix-fetch', version: '3.0.0' };
const DISCLAIMER = 'This receipt records returned bytes and supplied metadata locally. '
  + 'It does not independently prove mixnet routing, anonymity, source authenticity, '
  + 'or the accuracy of the metadata.';

function publicIpv4(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113));
}

function ipv6Value(hostname) {
  const halves = hostname.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function hasPrefix(value, prefix, bits) {
  const shift = BigInt(128 - bits);
  return (value >> shift) === (prefix >> shift);
}

function publicIpv6(hostname) {
  const value = ipv6Value(hostname);
  if (value === null) return false;
  // URL normalizes IPv4-mapped addresses to hexadecimal IPv6 notation.
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = Number(value & 0xffffffffn);
    return publicIpv4([ipv4 >>> 24, (ipv4 >>> 16) & 255, (ipv4 >>> 8) & 255, ipv4 & 255].join('.'));
  }
  // Accept global unicast only, excluding documentation, special-use and 6to4
  // ranges. This also excludes loopback, unspecified, ULA, link-local and multicast.
  return hasPrefix(value, 0x20000000000000000000000000000000n, 3)
    && !hasPrefix(value, 0x20010000000000000000000000000000n, 23)
    && !hasPrefix(value, 0x20010db8000000000000000000000000n, 32)
    && !hasPrefix(value, 0x20020000000000000000000000000000n, 16)
    && !hasPrefix(value, 0x3fff0000000000000000000000000000n, 20);
}

/** Validate literal host syntax only; this does not resolve DNS or prove routing. */
export function validateFeedUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(input)) {
    throw new TypeError('Enter an HTTPS feed URL of at most 4096 characters without whitespace.');
  }
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError('The feed URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || input.includes('#')
    || url.href.length > MAX_URL_LENGTH) {
    throw new TypeError('The feed URL must use HTTPS without credentials or a fragment.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')
    || host === 'local' || host.endsWith('.local')) {
    throw new TypeError('Local feed addresses are not allowed.');
  }
  const isIpv6 = host.startsWith('[') && host.endsWith(']');
  const isIpv4 = /^\d+(?:\.\d+){3}$/u.test(host);
  if ((isIpv6 && !publicIpv6(host.slice(1, -1))) || (isIpv4 && !publicIpv4(host))) {
    throw new TypeError('Private or reserved IP feed addresses are not allowed.');
  }
  return url;
}

function abortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('The response read was aborted.', 'AbortError');
  }
  const error = new Error('The response read was aborted.');
  error.name = 'AbortError';
  return error;
}

function cancelQuietly(body, reader, reason) {
  try {
    const cancellation = reader ? reader.cancel(reason) : body?.cancel(reason);
    Promise.resolve(cancellation).catch(() => {});
  } catch {
    // Preserve the original limit, stream or abort error even if cancellation fails.
  }
}

/** Read a fetch response with an independent bound on actual returned bytes. */
export async function readBoundedResponse(response, { maxBytes = MAX_BYTES, signal } = {}) {
  let reader;
  let onAbort;
  const body = response?.body;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_BYTES) {
      throw new RangeError('The byte limit must be an integer between 0 and MAX_BYTES.');
    }
    if (signal !== undefined && (typeof signal?.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('signal must be an AbortSignal.');
    }
    if (signal?.aborted) throw abortError();
    if (typeof response?.headers?.get !== 'function') throw new TypeError('A fetch Response is required.');
    const declared = response.headers.get('content-length');
    if (declared !== null) {
      if (!/^\d+$/u.test(declared)) throw new TypeError('Invalid Content-Length.');
      if (BigInt(declared) > BigInt(maxBytes)) throw new RangeError('Response exceeds the byte limit.');
    }
    if (body === null) return new Uint8Array(0);
    if (typeof body?.getReader !== 'function') throw new TypeError('A readable response body is required.');
    reader = body.getReader();
    let rejectAbort;
    const aborted = signal ? new Promise((_, reject) => { rejectAbort = reject; }) : null;
    if (signal) {
      // Also handle a pending read when the stream never produces another chunk.
      onAbort = () => {
        const error = abortError();
        cancelQuietly(body, reader, error);
        rejectAbort(error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const chunks = [];
    let total = 0;
    while (true) {
      if (signal?.aborted) throw abortError();
      const pending = reader.read();
      const { done, value } = await (aborted ? Promise.race([pending, aborted]) : pending);
      if (signal?.aborted) throw abortError();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('The response stream must contain bytes.');
      if (value.byteLength > maxBytes - total) throw new RangeError('Response exceeds the byte limit.');
      total += value.byteLength;
      chunks.push(value.slice());
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Content-Length can describe compressed transfer bytes. It is an early
    // size guard, not an equality assertion about the decoded response body.
    return bytes;
  } catch (error) {
    cancelQuietly(body, reader, error);
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    try { reader?.releaseLock(); } catch { /* Preserve the original outcome. */ }
  }
}

function exactRecord(value, keys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))
    || actual.some((key) => !('value' in descriptors[key]) || !descriptors[key].enumerable)) {
    throw new TypeError(`${name} has unsupported or missing fields.`);
  }
}

function validateMetadata(metadata) {
  const url = validateFeedUrl(metadata.requestedUrl);
  if (typeof metadata.receivedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(metadata.receivedAt)
    || !Number.isFinite(Date.parse(metadata.receivedAt))
    || new Date(metadata.receivedAt).toISOString() !== metadata.receivedAt) {
    throw new TypeError('receivedAt must be a valid canonical UTC ISO timestamp.');
  }
  if (!Number.isInteger(metadata.status) || metadata.status < 100 || metadata.status > 599) {
    throw new TypeError('status must be an HTTP status integer.');
  }
  if (typeof metadata.contentType !== 'string' || metadata.contentType.length > 256
    || /[\u0000-\u001f\u007f]/u.test(metadata.contentType)) {
    throw new TypeError('contentType must be a plain string of at most 256 characters.');
  }
  exactRecord(metadata.transport, ['kind', 'version'], 'transport');
  if (metadata.transport.kind !== TRANSPORT.kind || metadata.transport.version !== TRANSPORT.version) {
    throw new TypeError('Unsupported receipt transport.');
  }
  return url.href;
}

function validateBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array.');
  if (bytes.byteLength > MAX_BYTES) throw new RangeError('Snapshot exceeds MAX_BYTES.');
}

async function hashBytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable in this environment.');
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Create an unsigned local integrity record; metadata is not authenticated. */
export async function createReceipt(bytes, metadata) {
  validateBytes(bytes);
  exactRecord(metadata, ['requestedUrl', 'receivedAt', 'status', 'contentType', 'transport'], 'metadata');
  const requestedUrl = validateMetadata(metadata);
  const { receivedAt, status, contentType } = metadata;
  const byteLength = bytes.byteLength;
  return {
    schemaVersion: 1,
    sha256: await hashBytes(bytes),
    byteLength,
    requestedUrl,
    receivedAt,
    status,
    contentType,
    transport: { ...TRANSPORT },
    evidenceDisclaimer: DISCLAIMER,
  };
}

/** Verify bytes against the app's v1 format, without authenticating its origin. */
export async function verifyReceipt(bytes, receipt) {
  validateBytes(bytes);
  exactRecord(receipt, RECEIPT_KEYS, 'receipt');
  if (receipt.schemaVersion !== 1 || typeof receipt.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(receipt.sha256)
    || !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 0 || receipt.byteLength > MAX_BYTES
    || receipt.evidenceDisclaimer !== DISCLAIMER) {
    throw new TypeError('Malformed or unsupported receipt.');
  }
  if (validateMetadata(receipt) !== receipt.requestedUrl) {
    throw new TypeError('The receipt URL must be canonical.');
  }
  const expectedSha256 = receipt.sha256;
  const expectedBytes = receipt.byteLength;
  const actualBytes = bytes.byteLength;
  const actualSha256 = await hashBytes(bytes);
  return {
    ok: expectedSha256 === actualSha256 && expectedBytes === actualBytes,
    expectedSha256,
    actualSha256,
    expectedBytes,
    actualBytes,
  };
}
