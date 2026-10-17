# Verification record

## Transport feasibility, 2026-10-17 UTC

Before implementation, the official [Nym browser playground](https://nym.com/docs/developers/playground) was operated through its normal UI:

- `setupMixTunnel`: ready after 9.6 seconds, with no wallet, payment, account, ticketbook purchase or access-control workaround.
- A **via tunnel** GET of our own fictional Atom fixture, `https://dcftradingcrypt.github.io/feed-research-memory/demo/research.atom`: HTTP 200 in 4,587 ms.
- The client was then disconnected through the normal UI.

This establishes feasibility of the official browser transport. It is not a test result for this new app.

A separately hash-verified native SOCKS client could obtain topology but failed gateway DNS resolution before registration. No native retry, resolver override, proxy workaround or paid credential was used. The new app uses the independently working documented browser client.

## New application checks

Local implementation checks:

- 29 unit tests passed: 14 parser cases and 15 receipt / response-boundary cases.
- Full dependency audit after updating the development build tooling: zero reported vulnerabilities.
- Production static build succeeded with Vite 7.3.7 and esbuild 0.28.2. The large lazy-loaded Nym dependency is expected; it is not loaded until Connect.
- Independent in-memory UI reproductions confirmed that pending Disconnect blocks capture, timeout blocks another capture and suppresses late results, an old verification cannot overwrite a newer result, and changing either selected file invalidates pending verification.

## Deployed application run

Source commit `9039b26efc8fc7c4326364a6cbf0f45e523c4538`, tree `00b16fd88d425e74cacf5c76d1cd8384732c1dad`: all 17 public source files were independently compared with local bytes. GitHub Actions [39041292518](https://github.com/dcftradingcrypt/private-feed-snapshot/actions/runs/39041292518) passed install, all 29 tests, the full dependency audit, build and Pages deployment.

At `https://dcftradingcrypt.github.io/private-feed-snapshot/`, the normal Connect / fictional demo / Capture feed controls were operated:

- Actual Nym connection reported ready, then the owned demo feed returned HTTP 200.
- Capture time: `2026-10-17T14:36:23.490Z` (local receipt timestamp).
- Returned XML: 1,039 bytes, Atom, two entries.
- SHA-256: `e68fd46157dadf8c794a41aadab398b8fc08511171327303616b6ab057b98d53`.
- The rendered second summary retained literal `<p>` markup as text.
- Save XML and Save receipt each produced a real download. Both were read independently: the XML exactly matched the owned fixture, the receipt recorded HTTP 200 / application/atom+xml, and its length and digest matched those bytes.
- Disconnect completed and disabled another capture.

A later browser-harness file-selection operation lost its temporary files and returned NotFound. End-to-end verification through the file chooser is therefore **not claimed passed** in this environment. The file verifier's core hash / size / malformed-input / mutation cases passed unit tests.

## Deployed text-verification run

Revision `3f3e5863f97a07aa6e67b92f9b879b519909a188`, tree `2cd1c16af571eac911fb435fb1a339f20cefbfe5`: all 17 public files again matched local bytes. [Workflow 39052150902](https://github.com/dcftradingcrypt/private-feed-snapshot/actions/runs/39052150902) passed all verification and deployment steps. An independent local UI reproduction also checked eight paste / mutation / asynchronous-result cases.

The deployed app was reloaded and its normal controls were operated again:

1. Connect to Nym, choose the fictional demo, Capture feed: HTTP 200; 1,039 bytes; the same digest and two Atom entries. New receipt timestamp: `2026-10-17T17:06:31.882Z`.
2. Open **View captured text for manual copy** and read the actual captured XML and receipt from their visible read-only fields.
3. Disconnect. The UI confirmed closure and disabled capture.
4. Paste that actual captured XML and receipt into the local verification form and press **Check pasted text**: **MATCH — 1,039 bytes**.
5. Change `128 MiB` to `129 MiB` in the pasted XML and check again: **MISMATCH**.
6. Restore the actual XML and check again: **MATCH**. Both text panels were collapsed with the result retained.

This verifies the real Nym capture -> inspect captured text -> disconnect -> local UTF-8 integrity check and mutation-detection flow. It does not replace the explicitly uncompleted file-chooser test above. The record and screenshots are observational evidence, not a cryptographic attestation of routing or publisher authenticity.

The final documentation update adds these results and a prepared forum submission; it does not change the tested application code.
