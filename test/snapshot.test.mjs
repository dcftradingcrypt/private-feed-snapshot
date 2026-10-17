import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, validateFeedUrl, readBoundedResponse, createReceipt, verifyReceipt } from '../src/snapshot.mjs';

const bytes = new TextEncoder().encode('abc');
const metadata = () => ({
  requestedUrl: 'https://feeds.example.org/feed.xml',
  receivedAt: '2024-02-29T12:34:56.000Z',
  status: 200,
  contentType: 'application/atom+xml; charset=utf-8',
  transport: { kind: 'nym-mix-fetch', version: '3.0.0' },
});

test('HTTPS public host and literal addresses normalize without resolving DNS', () => {
  assert.equal(validateFeedUrl('https://EXAMPLE.org:443/feed.xml?q=1').href, 'https://example.org/feed.xml?q=1');
  for (const url of [
    'https://8.8.8.8/rss',
    'https://[2606:4700:4700::1111]/rss',
    'https://[::ffff:8.8.8.8]/rss',
    'https://localhost.example.org/rss',
  ]) assert.equal(validateFeedUrl(url).protocol, 'https:');
});

test('rejects unsafe URL syntax and all representative private/reserved literal ranges', () => {
  const rejected = [
    '', 'not-a-url', 'http://example.org/feed', 'file:///feed.xml',
    'https://user:password@example.org/feed', 'https://%75ser@example.org/feed',
    'https://example.org/feed#part', 'https://example.org/feed#',
    ' https://example.org/feed', 'https://example.org/\nfeed',
    'https://localhost/feed', 'https://LOCALHOST./feed', 'https://nested.localhost/feed',
    'https://device.local/feed', 'https://device.local./feed',
    ...['0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1',
      '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.1', '192.0.2.1',
      '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.1',
      '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '127.1', '2130706433', '0x7f000001', '0177.0.0.1']
      .map((ip) => `https://${ip}/feed`),
    ...['::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '2001:2::1',
      '2002:7f00:1::', '3fff::1', '64:ff9b::7f00:1']
      .map((ip) => `https://[${ip}]/feed`),
    `https://example.org/${'x'.repeat(4096)}`,
  ];
  for (const url of rejected) assert.throws(() => validateFeedUrl(url), { name: 'TypeError' }, url);
  assert.throws(() => validateFeedUrl(new URL('https://example.org/')), TypeError);
});

test('bounded read preserves ordered bytes, including empty chunks and an exact limit', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0, 1]));
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(new Uint8Array([254, 255]));
      controller.close();
    },
  });
  const actual = await readBoundedResponse(new Response(stream), { maxBytes: 4 });
  assert.ok(actual instanceof Uint8Array);
  assert.deepEqual([...actual], [0, 1, 254, 255]);
  assert.deepEqual(await readBoundedResponse(new Response(null), { maxBytes: 0 }), new Uint8Array(0));
});

test('oversized Content-Length cancels before reading the body', async () => {
  let cancelled = false;
  let read = false;
  const response = {
    headers: new Headers({ 'content-length': String(MAX_BYTES + 1) }),
    body: {
      getReader() { read = true; throw new Error('must not read'); },
      cancel() { cancelled = true; },
    },
  };
  await assert.rejects(readBoundedResponse(response), RangeError);
  assert.equal(read, false);
  assert.equal(cancelled, true);
});

test('actual stream cannot bypass the limit with absent or falsely small Content-Length', async () => {
  for (const length of [null, '1']) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() { cancelled = true; },
    });
    const headers = length ? { 'content-length': length } : {};
    await assert.rejects(readBoundedResponse(new Response(stream, { headers }), { maxBytes: 8 }), RangeError);
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test('Content-Length remains a size guard rather than a decompressed-byte equality assertion', async () => {
  const response = new Response(bytes, { headers: { 'content-length': '1', 'content-encoding': 'gzip' } });
  assert.deepEqual(await readBoundedResponse(response, { maxBytes: 8 }), bytes);
});

test('malformed declared lengths and invalid configured limits reject and cancel', async () => {
  for (const length of ['unknown', '-1', '+1', '1.5', '1, 2']) {
    let cancelled = false;
    const response = {
      headers: new Headers({ 'content-length': length }),
      body: { cancel() { cancelled = true; } },
    };
    await assert.rejects(readBoundedResponse(response), TypeError);
    assert.equal(cancelled, true);
  }
  for (const maxBytes of [-1, 1.5, NaN, Infinity, MAX_BYTES + 1]) {
    await assert.rejects(readBoundedResponse(new Response(bytes), { maxBytes }), RangeError);
  }
});

test('an already-aborted read cancels its response', async () => {
  const controller = new AbortController();
  controller.abort();
  let cancelled = false;
  const response = {
    headers: new Headers(),
    body: { cancel() { cancelled = true; } },
  };
  await assert.rejects(readBoundedResponse(response, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('abort interrupts a pending read and does not wait for an uncooperative cancel', { timeout: 1000 }, async () => {
  let cancelled = false;
  let released = false;
  const controller = new AbortController();
  const response = {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          read: () => new Promise(() => {}),
          cancel() { cancelled = true; return new Promise(() => {}); },
          releaseLock() { released = true; },
        };
      },
    },
  };
  const pending = readBoundedResponse(response, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('stream errors and non-byte chunks cancel while preserving the error', async () => {
  for (const invalidChunk of [false, true]) {
    let cancelled = false;
    const failure = new Error('synthetic stream failure');
    const response = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => { if (invalidChunk) return { done: false, value: 'not bytes' }; throw failure; },
          cancel() { cancelled = true; throw new Error('cancellation failure'); },
          releaseLock() {},
        }),
      },
    };
    await assert.rejects(readBoundedResponse(response), invalidChunk ? TypeError : failure);
    assert.equal(cancelled, true);
  }
});

test('receipt hashes exactly the bytes and validates an older saved JSON receipt', async () => {
  const receipt = await createReceipt(bytes, metadata());
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(receipt.byteLength, 3);
  assert.match(receipt.evidenceDisclaimer, /does not independently prove mixnet routing/u);
  assert.deepEqual(receipt.transport, metadata().transport);
  assert.deepEqual(await verifyReceipt(bytes, JSON.parse(JSON.stringify(receipt))), {
    ok: true,
    expectedSha256: receipt.sha256,
    actualSha256: receipt.sha256,
    expectedBytes: 3,
    actualBytes: 3,
  });
});

test('modified bytes and modified length report a failed verification with actual evidence', async () => {
  const receipt = await createReceipt(bytes, metadata());
  const changed = await verifyReceipt(new TextEncoder().encode('abd'), receipt);
  assert.equal(changed.ok, false);
  assert.equal(changed.expectedSha256, receipt.sha256);
  assert.notEqual(changed.actualSha256, receipt.sha256);
  assert.equal(changed.actualBytes, 3);
  const extended = await verifyReceipt(new TextEncoder().encode('abcd'), receipt);
  assert.equal(extended.ok, false);
  assert.equal(extended.expectedBytes, 3);
  assert.equal(extended.actualBytes, 4);
});

test('metadata is captured before the asynchronous digest completes', async () => {
  const input = metadata();
  const creating = createReceipt(bytes, input);
  input.receivedAt = 'invalid';
  input.status = 500;
  input.contentType = 'changed';
  const receipt = await creating;
  assert.equal(receipt.receivedAt, metadata().receivedAt);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.contentType, metadata().contentType);
  const verifying = verifyReceipt(bytes, receipt);
  const expectedSha256 = receipt.sha256;
  receipt.sha256 = '0'.repeat(64);
  receipt.byteLength = 0;
  assert.deepEqual(await verifying, {
    ok: true,
    expectedSha256,
    actualSha256: expectedSha256,
    expectedBytes: 3,
    actualBytes: 3,
  });
});

test('malformed and unsupported receipt formats are rejected before trust or display', async () => {
  const receipt = await createReceipt(bytes, metadata());
  const invalid = [
    { ...receipt, schemaVersion: 2 },
    { ...receipt, sha256: receipt.sha256.toUpperCase() },
    { ...receipt, sha256: 'a'.repeat(63) },
    { ...receipt, sha256: 'z'.repeat(64) },
    { ...receipt, byteLength: -1 },
    { ...receipt, byteLength: 1.5 },
    { ...receipt, byteLength: MAX_BYTES + 1 },
    { ...receipt, requestedUrl: 'https://127.0.0.1/feed' },
    { ...receipt, requestedUrl: 'https://EXAMPLE.org/feed' },
    { ...receipt, receivedAt: '2025-02-29T12:34:56.000Z' },
    { ...receipt, receivedAt: '2024-02-29T12:34:56+00:00' },
    { ...receipt, status: '200' },
    { ...receipt, status: 600 },
    { ...receipt, contentType: 'text/xml\nforged: header' },
    { ...receipt, contentType: 'a'.repeat(257) },
    { ...receipt, transport: { kind: 'direct-fetch', version: '3.0.0' } },
    { ...receipt, transport: { kind: 'nym-mix-fetch', version: '4.0.0' } },
    { ...receipt, evidenceDisclaimer: 'Routing is cryptographically proven.' },
    { ...receipt, routingProven: true },
    Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'contentType')),
    null,
  ];
  for (const item of invalid) await assert.rejects(verifyReceipt(bytes, item), TypeError);
});

test('creation rejects unsafe metadata, accessors, invalid byte types and oversized bytes', async () => {
  await assert.rejects(createReceipt(bytes, { ...metadata(), requestedUrl: 'http://example.org/' }), TypeError);
  await assert.rejects(createReceipt(bytes, { ...metadata(), receivedAt: 'not-a-date' }), TypeError);
  await assert.rejects(createReceipt(bytes, { ...metadata(), status: 0 }), TypeError);
  await assert.rejects(createReceipt(bytes, { ...metadata(), transport: { ...metadata().transport, attested: true } }), TypeError);
  const accessor = { ...metadata() };
  Object.defineProperty(accessor, 'status', { enumerable: true, get() { throw new Error('must not invoke getter'); } });
  await assert.rejects(createReceipt(bytes, accessor), /unsupported or missing fields/u);
  await assert.rejects(createReceipt(new ArrayBuffer(3), metadata()), TypeError);
  await assert.rejects(createReceipt(new Uint8Array(MAX_BYTES + 1), metadata()), RangeError);
  const receipt = await createReceipt(bytes, metadata());
  await assert.rejects(verifyReceipt(new Uint8Array(MAX_BYTES + 1), receipt), RangeError);
});
