// Server-side link previews. The server fetches the page itself so clients never hit
// arbitrary URLs just by rendering a message, and results are cached in SQLite.
//
// Fetching user-supplied URLs from the server is a classic SSRF vector, so every hop
// (including redirects) is resolved through a DNS lookup that refuses private, loopback,
// link-local and other non-public addresses. The check runs inside the socket's own
// lookup, so a DNS answer can't change between "validate" and "connect".
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import zlib from 'zlib';
import ogs from 'open-graph-scraper';
import { db } from './db.js';

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(addr, prefix, 'ipv6');

function isPublicAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  const family = net.isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Same signature as dns.lookup. Node calls it with { all: true } when happy-eyeballs is on,
// in which case the callback gets an array, so both shapes are handled.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return cb(Object.assign(new Error('Blocked non-public address'), { code: 'EBLOCKED' }));
    }
    cb(null, address, family);
  });
}

// Returns a normalized URL string, or null if the server shouldn't fetch it.
export function normalizeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) return null; // IP literals skip the DNS lookup
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  u.hash = '';
  return u.toString();
}

// First http(s) URL in a message, with trailing punctuation that's usually not part of it trimmed.
export function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[.,!?;:)\]]+$/, '') : null;
}

function fetchHtmlOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup,
        signal: AbortSignal.timeout(TIMEOUT_MS), // total time per hop, not just socket idle time
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChatLinkPreview/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (res) => {
        res.on('error', reject);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url).toString() });
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type'] || '')) {
          res.resume();
          return reject(new Error('Not HTML'));
        }
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        const stream =
          encoding === 'gzip' ? res.pipe(zlib.createGunzip())
          : encoding === 'deflate' ? res.pipe(zlib.createInflate())
          : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress())
          : res;
        const chunks = [];
        let size = 0;
        stream.on('data', (chunk) => {
          size += chunk.length;
          chunks.push(chunk);
          // <head> is all we need; stop reading once we have plenty, instead of failing.
          if (size >= MAX_BYTES) {
            req.destroy();
            resolve({ html: Buffer.concat(chunks).toString('utf8') });
          }
        });
        stream.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
        stream.on('error', reject);
      }
    );
    req.on('error', reject);
  });
}

async function fetchHtml(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await fetchHtmlOnce(current);
    if (result.html !== undefined) return { html: result.html, finalUrl: current };
    current = normalizeUrl(result.redirect);
    if (!current) throw new Error('Blocked redirect');
  }
  throw new Error('Too many redirects');
}

const httpUrlOrNull = (value, base) => {
  try {
    const u = new URL(value, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};
const clip = (s, n) => (s ? String(s).trim().slice(0, n) : null);

async function scrape(url) {
  const { html, finalUrl } = await fetchHtml(url);
  const { result } = await ogs({ html });
  const title = clip(result.ogTitle || result.twitterTitle || result.dcTitle, 200);
  if (!title) return null;
  const image = result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url;
  return {
    url,
    title,
    description: clip(result.ogDescription || result.twitterDescription || result.dcDescription, 300),
    image: image ? httpUrlOrNull(image, finalUrl) : null,
    siteName: clip(result.ogSiteName, 100) || new URL(finalUrl).hostname,
  };
}

const inFlight = new Map(); // url -> Promise, so a link pasted into many chats is fetched once

// Returns the cached preview if it's fresh (undefined if there's no usable cache entry).
export function getCachedPreview(url) {
  const row = db.getLinkPreview(url);
  if (!row) return undefined;
  const ttl = row.data ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
  if (Date.now() - Date.parse(row.fetchedAt) > ttl) return undefined;
  return row.data; // may be null: a cached failure
}

export function getLinkPreview(url) {
  const cached = getCachedPreview(url);
  if (cached !== undefined) return Promise.resolve(cached);
  if (inFlight.has(url)) return inFlight.get(url);
  const p = scrape(url)
    .catch(() => null)
    .then((data) => {
      db.saveLinkPreview(url, data, new Date().toISOString());
      return data;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}
