import './style.css';
import { parseFeed } from './feed.mjs';
import { MAX_BYTES, validateFeedUrl, readBoundedResponse, createReceipt, verifyReceipt } from './snapshot.mjs';

const $ = (id) => document.getElementById(id);
let sdk;
let state = 'idle';
let snapshot;
let captureController;
let verificationGeneration = 0;
const demoUrl = new URL('demo/research.atom', document.baseURI).href;
const status = (id, text, kind = '') => { $(id).textContent = text; $(id).className = `status ${kind}`; };
function setConnection(next, detail) {
  state = next;
  const names = { idle: 'Not connected', connecting: 'Connecting…', ready: 'Nym connected', disconnecting: 'Disconnecting…', closed: 'Disconnected', failed: 'Connection failed' };
  $('connection-state').textContent = names[next];
  $('connection-dot').className = `dot ${next === 'ready' ? 'ready' : next === 'connecting' ? 'busy' : ''}`;
  $('connection-detail').textContent = detail;
  $('connect').disabled = next !== 'idle';
  $('capture').disabled = next !== 'ready' || Boolean(captureController);
  $('disconnect').disabled = next !== 'ready' || Boolean(captureController);
}

$('connect').addEventListener('click', async () => {
  setConnection('connecting', 'Loading the official Nym client and registering a communication identity. This can take a minute.');
  try {
    sdk = await import('@nymproject/mix-fetch');
    const clientId = `pfs-${crypto.randomUUID()}`;
    const storagePassphrase = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    await sdk.setupMixTunnel({ clientId, storagePassphrase, maxRedirects: 0, connectTimeoutMs: 20_000, iprAttemptTimeoutMs: 20_000, iprMaxAttempts: 2, dnsTimeoutMs: 10_000 });
    setConnection('ready', 'Nym reports ready. Requests use mixFetch with no direct fallback. Nym stores encrypted communication state in this browser; clear site data to remove it.');
  } catch (error) {
    setConnection('failed', `Nym setup failed: ${error.message || String(error)}. Reload this page before reconnecting.`);
  }
});

$('disconnect').addEventListener('click', async () => {
  if (state !== 'ready' || captureController) return;
  setConnection('disconnecting', 'Closing the Nym client. Further captures are disabled.');
  try {
    await sdk.disconnectMixTunnel();
    setConnection('closed', 'The client is closed. Saved-byte verification still works. Reload this page to connect again.');
  } catch {
    setConnection('failed', 'The client could not confirm shutdown. Close this page to stop its remaining work. Reload before reconnecting.');
  }
});

$('use-demo').addEventListener('click', () => {
  $('feed-url').value = demoUrl;
  status('capture-status', 'Fictional demonstration data selected. Press Capture feed to request it through Nym.');
});

function showSnapshot(bytes, receipt, feed) {
  snapshot = { bytes, receipt };
  $('feed-title').textContent = feed.title || 'Untitled feed';
  $('feed-summary').textContent = `${feed.format.toUpperCase()} · ${feed.entries.length} entries · showing at most 8. Article content is displayed as plain text.`;
  $('capture-size').textContent = `${bytes.byteLength.toLocaleString()} bytes`;
  $('capture-hash').textContent = receipt.sha256;
  $('capture-time').textContent = receipt.receivedAt;
  $('captured-xml').value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  $('captured-receipt').value = JSON.stringify(receipt, null, 2);
  $('entries').replaceChildren();
  for (const entry of feed.entries.slice(0, 8)) {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = entry.title || entry.id;
    const summary = document.createElement('span');
    summary.textContent = entry.summary.slice(0, 350);
    li.append(title, summary);
    $('entries').append(li);
  }
  $('snapshot-result').hidden = false;
}

$('capture-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state !== 'ready' || captureController) return;
  $('snapshot-result').hidden = true;
  snapshot = undefined;
  let timer;
  let timedOut = false;
  try {
    const requestedUrl = validateFeedUrl($('feed-url').value).href;
    captureController = new AbortController();
    $('capture').disabled = true;
    $('disconnect').disabled = true;
    status('capture-status', 'Requesting the feed through Nym…');
    const response = await Promise.race([
      sdk.mixFetch(requestedUrl, { method: 'GET' }),
      new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Still waiting after 60 seconds. Close or reload this page before another capture.')); }, 60_000); }),
    ]);
    if (!response.ok) throw new Error(`The publisher returned HTTP ${response.status}. No snapshot was saved.`);
    const bytes = await readBoundedResponse(response, { maxBytes: MAX_BYTES, signal: captureController.signal });
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const feed = parseFeed(xml, requestedUrl);
    const receipt = await createReceipt(bytes, { requestedUrl, receivedAt: new Date().toISOString(), status: response.status, contentType: response.headers.get('content-type') || '', transport: { kind: 'nym-mix-fetch', version: '3.0.0' } });
    showSnapshot(bytes, receipt, feed);
    status('capture-status', 'Captured successfully. Save both the XML and its receipt.', 'success');
  } catch (error) {
    if (timedOut) {
      setConnection('failed', 'Capture wait limit reached. No further requests will start here. Close or reload this page to stop the remaining client work.');
      void sdk.disconnectMixTunnel().catch(() => {});
    }
    status('capture-status', `Capture failed: ${error.message || String(error)}`, 'error');
  } finally {
    clearTimeout(timer);
    captureController = undefined;
    $('capture').disabled = state !== 'ready';
    $('disconnect').disabled = state !== 'ready';
  }
});

function download(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
$('download-xml').addEventListener('click', () => { if (snapshot) download(snapshot.bytes, 'application/xml', 'feed-snapshot.xml'); });
$('download-receipt').addEventListener('click', () => { if (snapshot) download(`${JSON.stringify(snapshot.receipt, null, 2)}\n`, 'application/json', 'feed-snapshot.receipt.json'); });

for (const id of ['xml-file', 'receipt-file', 'pasted-xml', 'pasted-receipt']) {
  $(id).addEventListener(id.startsWith('pasted-') ? 'input' : 'change', () => {
    verificationGeneration += 1;
    status('verify-status', 'Selection changed. Check these files or pasted text to see their integrity result.');
  });
}

async function checkInputs(readInputs) {
  const generation = ++verificationGeneration;
  try {
    const { bytes, receipt } = await readInputs();
    const result = await verifyReceipt(bytes, receipt);
    if (generation !== verificationGeneration) return;
    status('verify-status', result.ok ? `MATCH — ${result.actualBytes.toLocaleString()} bytes. The supplied bytes match this receipt. This does not authenticate the receipt or publisher.` : 'MISMATCH — the XML does not match this receipt. The bytes or receipt may have changed.', result.ok ? 'success' : 'error');
  } catch (error) {
    if (generation !== verificationGeneration) return;
    status('verify-status', `Verification failed: ${error.message || String(error)}`, 'error');
  }
}

$('verify-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void checkInputs(async () => {
    const xml = $('xml-file').files[0];
    const record = $('receipt-file').files[0];
    if (!xml || !record) throw new Error('Select both an XML file and a receipt.');
    if (xml.size > MAX_BYTES) throw new Error('The XML file exceeds 1 MiB.');
    if (record.size > 32_768) throw new Error('The receipt exceeds 32 KiB.');
    return { bytes: new Uint8Array(await xml.arrayBuffer()), receipt: JSON.parse(await record.text()) };
  });
});

$('verify-text-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void checkInputs(() => {
    const bytes = new TextEncoder().encode($('pasted-xml').value);
    const record = $('pasted-receipt').value;
    if (bytes.byteLength > MAX_BYTES) throw new Error('The pasted XML exceeds 1 MiB as UTF-8.');
    if (new TextEncoder().encode(record).byteLength > 32_768) throw new Error('The pasted receipt exceeds 32 KiB.');
    return { bytes, receipt: JSON.parse(record) };
  });
});
