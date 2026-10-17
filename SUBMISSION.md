# Prepared Build with Nym submission

Status: prepared, **not posted to the Nym forum**. Forum registration / sign-in is required. This file is the concrete completed-project submission draft, not a funding proposal.

Suggested title: **Private Feed Snapshot — Nym RSS/Atom capture and offline byte verification**

Destination: Nym Squad League / Missions. Mission 8: Build with Nym. Submission tag: `tools-and-integrations` (use the available forum tag or state it in the body).

---

## Private Feed Snapshot

**Live:** https://dcftradingcrypt.github.io/private-feed-snapshot/  
**Source:** https://github.com/dcftradingcrypt/private-feed-snapshot  
**License:** Apache-2.0  
**Submission:** completed small project for Build with Nym, `tools-and-integrations`.

### Problem and working result

Fetching research feeds directly exposes the reader's network address and destination access pattern to publishers. This browser tool fetches a public HTTPS RSS 2.0 or Atom 1.0 feed through the real Nym browser client, then produces a portable XML snapshot and SHA-256 receipt. A reader can verify the saved bytes later without another feed request or an application server holding a reading history.

It uses `@nymproject/mix-fetch@3.0.0` with `mix-tunnel@0.3.0`, a single explicitly connected tunnel, redirect rejection and no direct-fetch fallback. The app does not fetch articles, images or enclosures. Feed summaries are rendered as plain text. The XML and receipt can be saved, or inspected and pasted into the local verifier when file transfer is unavailable.

### How to try

1. Open the live app, press Connect to Nym, then Use the fictional demo feed and Capture feed.
2. Inspect the parsed entries and byte hash. Open View captured text for manual copy or save the XML and receipt.
3. Disconnect, then use Verify saved bytes or the paste verifier.
4. Changing a character makes the comparison fail.

The demo is explicitly fictional. No wallet, account or payment is needed by the app; free gateway availability can vary.

### Current progress and evidence

Working v0.1.0 browser prototype, public source and HTTPS deployment. The [verification record](https://github.com/dcftradingcrypt/private-feed-snapshot/blob/main/VERIFICATION.md) distinguishes unit / synthetic UI tests from actual browser runs and records their immutable source revisions and CI links.

- 29 unit tests pass; the full dependency audit reports zero vulnerabilities; production build and Pages deployment pass.
- On 2026-10-17, the deployed app captured the owned demo through Nym: HTTP 200, 1,039 XML bytes, two Atom entries.
- Actual digest: `e68fd46157dadf8c794a41aadab398b8fc08511171327303616b6ab057b98d53`.
- After disconnecting, the actual captured text and receipt produced MATCH. Changing `128 MiB` to `129 MiB` produced MISMATCH; restoring the text produced MATCH.
- The initial real XML / receipt downloads were independently compared with the fixture. A later browser-harness file-chooser test lost its temporary files, so file-chooser end-to-end verification is explicitly unclaimed. The pasted-text path was tested on the deployed app.

### Attribution and limits

The RSS/Atom parser and fictional fixtures derive from our own earlier Apache-2.0 Feed Research Memory project at `91c24feea6752d544d877831176addc54f69944b`. Its existing parser is disclosed as reused work. The Nym lifecycle, capture UI, byte receipt and offline verifier are new work here. Implementation and documentation used AI assistance; the cited runtime results were actually executed.

A receipt is unsigned local metadata. It verifies byte consistency, not independent proof of routing, anonymity, publisher identity or historical publication. Nym setup remains visible to network infrastructure and the exit sees the destination. HTTPS validation stays enabled. The SDK buffers a response before the app enforces its 1 MiB acceptance limit. Its request cannot be canceled by AbortSignal, so the UI disables further captures after a 60-second wait limit and requests shutdown. Nym communication state persists encrypted in browser storage under a fresh namespace; clearing site data removes it.

### Possible next work

A transport-level streaming cap when supported upstream, signed receipts and a documented downstream research export format. These are future ideas, not implemented features.

Please assess this completed project under Build with Nym Mission 8. A compatible reward receiving address can be provided if required after assessment; no award or payment is claimed by this submission.
