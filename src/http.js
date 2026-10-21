// HTTP helpers shared by the routes: answers, request bodies, CSV, money formatting.
const { prefixBody, prefixLocation } = require('./basepath');

// Shop pages may contain admin-written HTML (the campaign header): scripts in it must not run.
const SHOP_HEADERS = { 'Content-Security-Policy': "script-src 'self'; object-src 'none'; base-uri 'self'" };

const send = (res, code, body, type = 'text/html; charset=utf-8', headers = {}) => {
  if (headers.Location) headers = { ...headers, Location: prefixLocation(headers.Location) };
  res.writeHead(code, { 'Content-Type': type, ...headers });
  res.end(prefixBody(body, type));
};
const redirect = (res, url, headers = {}) => send(res, 303, '', 'text/plain', { Location: url, ...headers });
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
const download = (name) => ({ 'Content-Disposition': `attachment; filename="${name}"` });
const msgUrl = (base, msg) => `${base}${base.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`;   // a notice shown on the next page

// Reads the whole body (so the client gets a proper answer), rejecting if it exceeds `max` bytes.
function readBuffer(req, max = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size <= max) chunks.push(c); });
    req.on('end', () => (size > max ? reject(new Error('too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
const readBody = async (req, max) => (await readBuffer(req, max)).toString();
const readForm = async (req) => new URLSearchParams(await readBody(req));

// The kind of image a file really is (never trust the file name or the Content-Type), or null.
function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// CSV for French spreadsheets: ";" separator, BOM, and a leading ' on cells that could run as a formula.
const csvCell = (x) => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',');

module.exports = { SHOP_HEADERS, send, redirect, sendJson, download, msgUrl, readBuffer, readBody, readForm, sniffImage, csv, eur };
