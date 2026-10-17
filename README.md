# Private Feed Snapshot

A small browser tool that captures a public RSS 2.0 or Atom 1.0 feed through the Nym mixnet. Save the received XML and a SHA-256 receipt, then verify the saved bytes locally. Feed summaries are rendered as plain text; articles, images and enclosures are never loaded.

The purpose is reproducible feed research without making each feed request directly from the reader to the publisher. The result is a portable snapshot, rather than a cloud reading history.

## Use

1. Open the deployed app over HTTPS and press **Connect to Nym**. Setup contacts Nym topology services and an entry gateway and creates a communication identity with a fresh random storage namespace. No wallet, account, payment or browser extension is required by this app. Free network service availability may vary.
2. Enter the final public HTTPS feed URL, or choose the explicitly fictional demo. Press **Capture feed**.
3. Save both **XML** and **receipt**. The receipt contains the requested URL and the local capture timestamp; sharing it reveals those fields.
4. Select those two saved files under **Verify saved bytes**, or expand **Or paste XML and receipt text** and paste their contents. **View captured text for manual copy** exposes the current snapshot without a file transfer. Pasted text is encoded as UTF-8; copying may normalize line endings, which correctly produces a mismatch if the bytes change. This check makes no network request and does not require a Nym connection. Changing a byte or pairing the wrong files produces a mismatch.
5. Press **Disconnect** when finished. The upstream client is one-shot: reload the page before reconnecting.

The app has no backend, analytics, external fonts, browser-cookie authentication, direct-fetch fallback or persisted feed history. Hosting services see the initial app load. The pinned Nym client supplies the transport. Nym does persist encrypted communication keys and gateway state in browser storage. This app supplies a fresh random namespace and a random storage passphrase kept only in page memory on every page load. Old namespaces are not automatically deleted or recoverable after reload; clear the site data to remove that SDK state. These keys are not a payment wallet.

## Development

Node 22.12+ or Node 24 is required.

```sh
npm ci
npm test
npm run build
```

The static output is `dist/`. Deploy it to any HTTPS static host; the build uses relative asset paths. `npm run dev` binds only `127.0.0.1`. A modern browser must support WebAssembly, Web Workers, Web Crypto and Blob URLs. The Nym WASM worker is included in the dependency bundle and loaded only after Connect is pressed.

## What is verified

The v1 receipt records a SHA-256 digest and length of the returned XML bytes, requested URL, local timestamp, HTTP status, content type and configured transport version. Offline verification validates its format and recomputes the digest and length. The receipt is **not signed**. Anyone who can edit both files can create a new matching pair.

A matching receipt proves byte consistency with that receipt. It does not independently prove mixnet routing, anonymity, publisher identity, an historical publication date or the accuracy of supplied metadata. Evidence of actual app runs belongs in `VERIFICATION.md`, separately from the portable receipt.

## Limits and privacy

- The transport is `@nymproject/mix-fetch@3.0.0`, using `@nymproject/mix-tunnel@0.3.0`. Capture calls use `mixFetch`, never `window.fetch`. Redirects are disabled with the supported tunnel option `maxRedirects: 0`; enter the final feed URL.
- Nym initialization is visible to Nym API and gateway infrastructure. An exit sees the destination. HTTPS certificate validation remains enabled. Browser compromise, destination fingerprinting, local activity and publisher-side identification remain outside this tool's protection. Complete anonymity is not promised.
- Only public HTTPS URLs are accepted. Embedded URL credentials and literal local/private/reserved addresses are rejected. This is not a DNS-rebinding firewall: the app does not resolve a name locally to validate its eventual address. Do not enter private feeds or URLs containing access tokens.
- The upstream SDK buffers the whole response **before** returning a DOM Response. The app's 1 MiB limit is an acceptance limit after SDK buffering, not a hard network-transfer or memory cap. Use small, trusted public feeds. A declared or actual over-limit response is rejected.
- The UI stops waiting after 60 seconds. The SDK has no per-request AbortSignal support; this does **not** prove cancellation of an in-flight network operation. After a timeout, further captures are disabled, a best-effort whole-tunnel shutdown is requested, and the page instructs the reader to close or reload it.
- Parsing accepts UTF-8 XML, rejects DOCTYPE, and bounds element depth to 32, element count to 10,000, and each summary to 65,536 UTF-16 code units. Unsupported or malformed feeds fail explicitly. The app shows at most eight entry summaries and does not render supplied HTML.
- Verification accepts XML up to 1 MiB and a receipt up to 32 KiB. Local files are read only after selection, are not uploaded, and remain in memory until the page closes.

## Originality and attribution

The Nym lifecycle, browser capture flow, byte receipt, offline verification and UI are new work for this project. The RSS/Atom parser and fictional demo feed derive from our own [Feed Research Memory](https://github.com/dcftradingcrypt/feed-research-memory) at commit `91c24feea6752d544d877831176addc54f69944b`, under Apache-2.0. The parser has been adapted with explicit resource limits, DOCTYPE rejection and browser use. This project does not modify that submitted OriginTrail integration and does not claim its pre-existing parser as new Nym work.

Implementation and documentation were developed with AI assistance. Runtime results must be established by actual tests and UI runs, not inferred from generated code. This is an independent community project, with no Nym endorsement implied.

## Next steps

Possible improvements are signed snapshot receipts, a transport-level streaming size limit when the SDK supports one, and an explicit export format for downstream feed research tools. These are future ideas, not implemented features.

Apache-2.0. See `LICENSE` and `NOTICE`.
