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

The deployed app's real capture / download / offline-verify flow is still pending. No completed app deployment or end-to-end app capture is claimed yet. This record will be extended with concrete results before a completed-project mission submission.
