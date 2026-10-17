/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 dcftradingcrypt.
 *
 * Adapted from the author's Feed Research Memory parser at commit
 * 91c24feea6752d544d877831176addc54f69944b:
 * https://github.com/dcftradingcrypt/feed-research-memory/blob/91c24feea6752d544d877831176addc54f69944b/src/feed.mjs
 * Changes: browser-compatible input/tree/summary bounds, explicit DTD rejection,
 * nonduplicated text storage, strict RSS namespaces and correct xml:base handling.
 * HTML carried as XML text/CDATA remains literal text, for textContent rendering.
 */
import { SaxesParser } from 'saxes';

const MAX_XML_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 10000;
const MAX_SUMMARY_CHARS = 65536;
const ATOM = 'http://www.w3.org/2005/Atom';
const DC = 'http://purl.org/dc/elements/1.1/';
const CONTENT = 'http://purl.org/rss/1.0/modules/content/';
const XHTML = 'http://www.w3.org/1999/xhtml';
const BLOCKS = new Set(['div', 'p', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);

// Each fragment belongs to one element. Flatten only selected fields, iteratively;
// accumulating every text event in every ancestor would duplicate large subtrees.
function textOf(node) {
  if (node.cachedText !== undefined) return node.cachedText;
  const pieces = [];
  const pending = [...node.parts].reverse();
  while (pending.length) {
    const part = pending.pop();
    if (typeof part === 'string') pieces.push(part);
    else for (let i = part.parts.length - 1; i >= 0; i--) pending.push(part.parts[i]);
  }
  node.cachedText = pieces.join('').trim();
  return node.cachedText;
}

const children = (node, name, uri = node.uri) => node.children.filter((n) => n.local === name && n.uri === uri);
const firstIn = (node, uri, name) => children(node, name, uri).map(textOf).find(Boolean) || '';
const first = (node, ...names) => {
  for (const name of names) {
    const found = children(node, name).find((n) => textOf(n));
    if (found) return textOf(found);
  }
  return '';
};

function httpUrl(value, base, stripFragment = false) {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (stripFragment) url.hash = '';
    return url.href;
  } catch { return ''; }
}

function resolveBase(value, parentBase) {
  if (value === undefined) return parentBase;
  try { return new URL(value, parentBase).href; }
  catch { throw new Error('Invalid xml:base URL.'); }
}

function isoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}

/**
 * Parse RSS 2.0 or Atom 1.0 without fetching content or subresources.
 * Limits: 1 MiB UTF-8 input, 32 element levels, 10,000 elements, and 65,536
 * UTF-16 code units per summary. Excesses fail explicitly; nothing is truncated.
 * Comments/processing instructions are ignored. HTML strings remain inert text.
 */
export function parseFeed(xml, sourceUrl) {
  if (typeof xml !== 'string') throw new Error('Feed XML must be a string.');
  if (xml.length > MAX_XML_BYTES || new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) {
    throw new Error('Feed XML exceeds the 1 MiB UTF-8 limit.');
  }
  const source = httpUrl(sourceUrl, undefined, true);
  if (!source) throw new Error('The feed source must be an absolute HTTP(S) URL.');
  const parser = new SaxesParser({ xmlns: true });
  const document = { children: [], parts: [], base: source };
  const stack = [document];
  let nodeCount = 0;
  const appendText = (value) => { if (value) stack.at(-1).parts.push(value); };
  parser.on('doctype', () => { throw new Error('DOCTYPE declarations are not allowed in feeds.'); });
  // Keep saxes' default throwing error behavior: malformed XML cannot be trusted.
  parser.on('opentag', (tag) => {
    if (stack.length > MAX_DEPTH) throw new Error('Feed XML exceeds the nesting limit of 32 elements.');
    if (++nodeCount > MAX_NODES) throw new Error('Feed XML exceeds the limit of 10000 elements.');
    if (tag.uri === XHTML) {
      if (BLOCKS.has(tag.local)) appendText('\n');
      else if (tag.local === 'td' || tag.local === 'th') appendText('\t');
    }
    const parent = stack.at(-1);
    const attrs = Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value]));
    const base = resolveBase(attrs['xml:base'], parent.base);
    const node = { local: tag.local, uri: tag.uri, attrs, base, parts: [], children: [] };
    parent.children.push(node);
    parent.parts.push(node);
    stack.push(node);
  });
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', (tag) => {
    if (tag.uri === XHTML && BLOCKS.has(tag.local)) appendText('\n');
    stack.pop();
  });
  parser.write(xml).close();
  const root = document.children[0];
  let entries;
  let title;
  let format;
  if (root?.local === 'feed' && root.uri === ATOM) {
    format = 'atom';
    title = first(root, 'title');
    entries = children(root, 'entry').map((entry) => {
      const links = children(entry, 'link');
      const link = links.find((n) => (!n.attrs.rel || n.attrs.rel === 'alternate') && httpUrl(n.attrs.href, n.base));
      const url = link ? httpUrl(link.attrs.href, link.base) : '';
      return {
        id: first(entry, 'id') || url,
        url,
        title: first(entry, 'title'),
        summary: first(entry, 'summary', 'content'),
        author: (children(entry, 'author').length ? children(entry, 'author') : children(root, 'author'))
          .map((n) => first(n, 'name')).filter(Boolean).join('; '),
        published: isoDate(first(entry, 'published')),
        updated: isoDate(first(entry, 'updated')),
        categories: children(entry, 'category').map((n) => n.attrs.term).filter(Boolean),
      };
    });
  } else if (root?.local === 'rss' && root.uri === '' && root.attrs.version === '2.0') {
    const channel = children(root, 'channel')[0];
    if (!channel) throw new Error('RSS document has no channel.');
    format = 'rss';
    title = first(channel, 'title');
    entries = children(channel, 'item').map((entry) => {
      const link = children(entry, 'link')[0];
      const guid = children(entry, 'guid')[0];
      const permalink = guid && guid.attrs.isPermaLink !== 'false' ? httpUrl(textOf(guid)) : '';
      const url = (link ? httpUrl(textOf(link), link.base) : '') || permalink;
      return {
        id: first(entry, 'guid') || url,
        url,
        title: first(entry, 'title'),
        summary: first(entry, 'description') || firstIn(entry, CONTENT, 'encoded'),
        author: first(entry, 'author') || firstIn(entry, DC, 'creator'),
        published: isoDate(first(entry, 'pubDate') || firstIn(entry, DC, 'date')),
        updated: '',
        categories: children(entry, 'category').map(textOf).filter(Boolean),
      };
    });
  } else {
    throw new Error('Expected an RSS 2.0 or Atom 1.0 feed.');
  }
  for (const [index, entry] of entries.entries()) {
    if (!entry.id) throw new Error(`Entry ${index + 1} has no stable id, guid or HTTP(S) link.`);
    if (entry.summary.length > MAX_SUMMARY_CHARS) {
      throw new Error(`Entry ${index + 1} summary exceeds the 65536-character limit.`);
    }
    entry.categories = [...new Set(entry.categories)].sort();
  }
  return { source, title, format, entries };
}
