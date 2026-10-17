import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/feed.mjs';

const SOURCE = 'https://feeds.example/research/feed.xml';
const ATOM = 'http://www.w3.org/2005/Atom';
const rss = (body, attrs = '') => `<rss version="2.0" ${attrs}><channel>${body}</channel></rss>`;
const item = (body) => `<item><guid isPermaLink="false">paper-1</guid>${body}</item>`;
const atom = (body, attrs = '') => `<feed xmlns="${ATOM}" ${attrs}>${body}</feed>`;

test('RSS 2.0 retains attribution, Dublin Core, content, dates and distinct section links', () => {
  const xml = rss(`<title>Research</title>
    <item><link>../paper#method-a</link><title>日本語 &amp; evidence</title>
      <dc:creator>Researcher</dc:creator><dc:date>2026-10-17T12:00:00Z</dc:date>
      <content:encoded><![CDATA[<p>Result &amp; explanation</p>]]></content:encoded>
      <category>z</category><category>a</category><category>z</category>
    </item>
    <item><link>../paper#method-b</link><title>Other section</title></item>`,
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"');
  const parsed = parseFeed(xml, `${SOURCE}#subscription`);
  assert.equal(parsed.source, SOURCE);
  assert.equal(parsed.title, 'Research');
  assert.equal(parsed.format, 'rss');
  assert.equal(parsed.entries[0].title, '日本語 & evidence');
  assert.equal(parsed.entries[0].author, 'Researcher');
  assert.equal(parsed.entries[0].published, '2026-10-17T12:00:00.000Z');
  assert.equal(parsed.entries[0].summary, '<p>Result &amp; explanation</p>');
  assert.deepEqual(parsed.entries[0].categories, ['a', 'z']);
  assert.equal(parsed.entries[0].id, 'https://feeds.example/paper#method-a');
  assert.equal(parsed.entries[1].id, 'https://feeds.example/paper#method-b');
});

test('RSS guid permalink fallback respects isPermaLink=false and rejects unsafe link schemes', () => {
  const parsed = parseFeed(rss(`
    <item><guid>https://papers.example/article#result</guid></item>
    <item><guid isPermaLink="false">https://papers.example/opaque</guid>
      <link>javascript:alert(1)</link></item>`), SOURCE);
  assert.equal(parsed.entries[0].url, 'https://papers.example/article#result');
  assert.equal(parsed.entries[1].url, '');
  assert.equal(parsed.entries[1].id, 'https://papers.example/opaque');
});

test('Atom namespaces, inherited authors, nested xml:base and alternate link selection', () => {
  const xml = `<a:feed xmlns:a="${ATOM}" xmlns:e="urn:extension" xml:base="https://papers.example/base/">
    <e:title>Wrong feed title</e:title><a:title>Feed</a:title>
    <a:author><a:name>Feed author</a:name></a:author>
    <a:entry xml:base="../entries/">
      <e:id>wrong-id</e:id><a:id>urn:paper:one</a:id><a:title>Paper</a:title>
      <a:link rel="self" href="self.xml"/>
      <a:link xml:base="../citations/" href="one#section"/>
      <a:summary>Evidence</a:summary><a:updated>2026-10-17T00:00:00Z</a:updated>
      <a:category term="topic"/><e:category term="ignored"/>
    </a:entry>
    <a:entry><a:id>urn:paper:two</a:id><a:author><a:name>Local author</a:name></a:author></a:entry>
  </a:feed>`;
  const parsed = parseFeed(xml, SOURCE);
  assert.equal(parsed.title, 'Feed');
  assert.equal(parsed.entries[0].id, 'urn:paper:one');
  assert.equal(parsed.entries[0].author, 'Feed author');
  assert.equal(parsed.entries[0].url, 'https://papers.example/citations/one#section');
  assert.equal(parsed.entries[0].updated, '2026-10-17T00:00:00.000Z');
  assert.deepEqual(parsed.entries[0].categories, ['topic']);
  assert.equal(parsed.entries[1].author, 'Local author');
});

test('RSS link-level relative xml:base resolves against that element', () => {
  const xml = rss(item('<link xml:base="https://papers.example/">paper1</link>'));
  assert.equal(parseFeed(xml, SOURCE).entries[0].url, 'https://papers.example/paper1');
});

test('non-HTTP xml:base is not silently replaced with a false HTTP citation', () => {
  const xml = atom(`<entry xml:base="file:///archive/"><id>urn:entry:1</id><link href="paper"/></entry>
    <entry xml:base="data:text/plain,base"><id>urn:entry:2</id><link href="https://papers.example/real"/></entry>`);
  const parsed = parseFeed(xml, SOURCE);
  assert.equal(parsed.entries[0].url, '');
  assert.equal(parsed.entries[1].url, 'https://papers.example/real');
  assert.throws(() => parseFeed(atom('<entry xml:base="https://["><id>one</id></entry>'), SOURCE), /xml:base/);
});

test('HTML text stays literal; comments and processing instructions add no content or fetches', (t) => {
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', () => { fetches++; throw new Error('Parser must not fetch.'); });
  const xml = `<?xml-stylesheet href="https://tracker.invalid/style.xsl"?>${atom(`
    <entry><id>urn:html</id><summary type="html">&lt;img src="https://tracker.invalid/pixel" onerror="alert(1)"&gt;</summary></entry>
    <entry><id>urn:text</id><summary type="text">&lt;b&gt;literal&lt;/b&gt;</summary></entry>
    <entry><id>urn:mixed</id><summary>start<!--hidden--><![CDATA[<p>middle</p>]]>end</summary></entry>
    <entry><id>urn:external</id><content src="https://tracker.invalid/article"/></entry>`)}
  `;
  const parsed = parseFeed(xml, SOURCE);
  assert.equal(parsed.entries[0].summary, '<img src="https://tracker.invalid/pixel" onerror="alert(1)">');
  assert.equal(parsed.entries[1].summary, '<b>literal</b>');
  assert.equal(parsed.entries[2].summary, 'start<p>middle</p>end');
  assert.equal(parsed.entries[3].summary, '');
  assert.equal(fetches, 0);
});

test('XHTML preserves paragraph and table-cell boundaries without rendering markup', () => {
  const xml = atom(`<entry><id>urn:xhtml</id><content type="xhtml">
    <div xmlns="http://www.w3.org/1999/xhtml"><p>Memory: 128 MiB.</p><p>Time: 12 ms.</p>
      <table><tr><th>Method</th><th>MiB</th></tr><tr><td>A</td><td>128</td></tr></table>
    </div></content></entry>`);
  const summary = parseFeed(xml, SOURCE).entries[0].summary;
  assert.match(summary, /Memory: 128 MiB\.\n+Time: 12 ms\./);
  assert.match(summary, /Method\tMiB/);
  assert.match(summary, /A\t128/);
  assert.doesNotMatch(summary, /<p>|<table>/);
});

test('only genuine RSS 2.0 or Atom 1.0 roots are accepted', () => {
  assert.throws(() => parseFeed('<x:rss xmlns:x="urn:fake" version="2.0"><x:channel/></x:rss>', SOURCE), /RSS 2\.0 or Atom/);
  assert.throws(() => parseFeed('<feed><entry/></feed>', SOURCE), /RSS 2\.0 or Atom/);
  assert.throws(() => parseFeed('<rss version="0.92"><channel/></rss>', SOURCE), /RSS 2\.0 or Atom/);
  assert.throws(() => parseFeed('<rss version="2.0"/>', SOURCE), /no channel/);
  assert.throws(() => parseFeed(rss('<item><title>No identity</title></item>'), SOURCE), /stable id/);
  assert.throws(() => parseFeed(rss(''), 'file:///feed.xml'), /absolute HTTP/);
  assert.throws(() => parseFeed(null, SOURCE), /must be a string/);
});

test('malformed XML, unknown entities and malformed trailing content fail rather than return partial entries', () => {
  for (const xml of [
    '<rss version="2.0"><channel></rss>',
    rss(item('<description>&unknown;</description>')),
    `${rss(item('<title>Valid first entry</title>'))}<unclosed>`,
    rss(item('<title>&#0;</title>')),
  ]) assert.throws(() => parseFeed(xml, SOURCE));
  assert.equal(parseFeed(rss(item('<title>&lt;A&gt; &amp; &#x65E5;</title>')), SOURCE).entries[0].title, '<A> & 日');
});

test('actual internal/external DOCTYPE declarations are rejected while harmless literal text is accepted', () => {
  for (const dtd of [
    '<!DOCTYPE rss>',
    '<!DOCTYPE rss SYSTEM "https://external.invalid/feed.dtd">',
    '<!DOCTYPE rss [<!ENTITY sample "expanded">]>',
    '<!DOCTYPE rss [<!ENTITY external SYSTEM "file:///etc/passwd">]>',
  ]) assert.throws(() => parseFeed(`${dtd}${rss('')}`, SOURCE), /DOCTYPE/);
  const xml = rss(`<!-- <!DOCTYPE rss> -->${item('<description><![CDATA[<!DOCTYPE rss> is literal text]]></description>')}`);
  assert.equal(parseFeed(xml, SOURCE).entries[0].summary, '<!DOCTYPE rss> is literal text');
});

test('the input ceiling counts UTF-8 bytes and accepts exactly 1 MiB', () => {
  const max = 1024 * 1024;
  const prefix = '<rss version="2.0"><channel><!--';
  const suffix = '--></channel></rss>';
  const padding = max - new TextEncoder().encode(prefix + suffix).byteLength;
  const exact = prefix + ' '.repeat(padding) + suffix;
  assert.equal(new TextEncoder().encode(exact).byteLength, max);
  assert.equal(parseFeed(exact, SOURCE).format, 'rss');
  assert.throws(() => parseFeed(prefix + ' '.repeat(padding + 1) + suffix, SOURCE), /1 MiB UTF-8/);
  for (const glyph of ['日', '💡']) {
    const xml = prefix + glyph.repeat(Math.floor(max / new TextEncoder().encode(glyph).byteLength)) + suffix;
    assert.ok(xml.length < max);
    assert.throws(() => parseFeed(xml, SOURCE), /1 MiB UTF-8/);
  }
});

test('element nesting allows 32 levels and rejects 33 before building an unbounded tree', () => {
  const nested = (depth) => rss(item(`<description>${'<span>'.repeat(depth - 4)}value${'</span>'.repeat(depth - 4)}</description>`));
  assert.equal(parseFeed(nested(32), SOURCE).entries[0].summary, 'value');
  assert.throws(() => parseFeed(nested(33), SOURCE), /nesting limit of 32/);
});

test('element budget includes self-closing extension elements and allows exactly 10000', () => {
  const xml = (count) => rss('<extra/>'.repeat(count - 2));
  assert.deepEqual(parseFeed(xml(10000), SOURCE).entries, []);
  assert.throws(() => parseFeed(xml(10001), SOURCE), /10000 elements/);
});

test('summary capacity fails explicitly without silently clipping captured evidence', () => {
  assert.equal(parseFeed(rss(item(`<description>${'a'.repeat(65536)}</description>`)), SOURCE).entries[0].summary.length, 65536);
  assert.throws(() => parseFeed(rss(item(`<description>${'a'.repeat(65537)}</description>`)), SOURCE), /summary exceeds/);
});
