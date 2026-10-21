// Minimal HelloAsso v5 client (sandbox by default). Keys come from login.txt (next to this file)
// ("public:" and "secret:" lines) or HELLOASSO_CLIENT_ID / HELLOASSO_CLIENT_SECRET.
const fs = require('node:fs');
const path = require('node:path');

const API = process.env.HELLOASSO_API || 'https://api.helloasso-sandbox.com';
const ORG = process.env.HELLOASSO_ORG || 'l-elefan';
const UA = 'curl/8.5.0'; // the default fetch/urllib user agents get a 403 from HelloAsso's Cloudflare

function readKeys() {
  if (process.env.HELLOASSO_CLIENT_ID && process.env.HELLOASSO_CLIENT_SECRET)
    return { id: process.env.HELLOASSO_CLIENT_ID, secret: process.env.HELLOASSO_CLIENT_SECRET };
  const lines = fs.readFileSync(path.join(require('./config').ROOT, 'login.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const after = (tag) => {
    const i = lines.findIndex((l) => l.toLowerCase().startsWith(tag));
    if (i < 0 || !lines[i + 1]) throw new Error(`login.txt: no "${tag}" line`);
    return lines[i + 1];
  };
  return { id: after('public'), secret: after('secret') };
}

let cached = { token: null, exp: 0 };
async function token() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const { id, secret } = readKeys();
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`HelloAsso token ${res.status}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + 25 * 60 * 1000 }; // valid ~30 min
  return cached.token;
}

async function call(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : null };
}

const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

// items: [{ product, variant, size, qty }]. HelloAsso shows itemName in its dashboard and on the receipt;
// metadata is stored with the checkout and comes back through the API and webhooks.
async function createCheckout({ orderId, campaignName, firstName, lastName, email, comment, items, totalCents, baseUrl }) {
  const summary = items.map((i) => `${i.qty}× ${[i.product, i.variant, i.size].filter(Boolean).join(' ')}`).join(', ');
  const r = await call('POST', `/v5/organizations/${ORG}/checkout-intents`, {
    totalAmount: totalCents,
    initialAmount: totalCents,
    itemName: clip(`Précommande #${orderId} (${campaignName}) : ${summary}`, 250),
    backUrl: `${baseUrl}/`,
    errorUrl: `${baseUrl}/retour?o=${orderId}`,
    returnUrl: `${baseUrl}/retour?o=${orderId}`,
    containsDonation: false,
    payer: { firstName, lastName, email },
    metadata: { orderId, campaign: campaignName, comment: clip(comment || '', 500), items: clip(summary, 1000) },
  });
  if (r.status !== 200) {
    const e = new Error(`HelloAsso ${r.status}: ${r.text.slice(0, 300)}`);
    // HelloAsso explains validation problems in French ("Votre prénom est trop court"): keep them to show the customer
    if (r.status === 400 && r.json && Array.isArray(r.json.errors)) e.userMessage = r.json.errors.map((x) => x.message).filter(Boolean).join(' ');
    throw e;
  }
  return r.json; // { id, redirectUrl }
}

// Is the checkout paid? Accepted money = payment state Authorized/Registered covering the total.
async function paymentStatus(intentId, totalCents) {
  const r = await call('GET', `/v5/organizations/${ORG}/checkout-intents/${intentId}`);
  if (r.status !== 200) return { paid: false, raw: r.text };
  const payments = (r.json.order && r.json.order.payments) || [];
  const ok = payments.filter((p) => ['Authorized', 'Registered'].includes(p.state));
  const paid = ok.length > 0 && ok.reduce((s, p) => s + (p.amount || 0), 0) >= totalCents;
  return { paid, raw: r.text };
}

// Full refund of one payment. Needs the RefundManagement privilege, which the API client has.
// Sending amount/comment as query parameters makes HelloAsso answer 400 with an empty body; with no parameters it
// refunds the whole payment, which is all this app does. If the call fails but the payment is already refunded
// (e.g. an earlier attempt went through), that counts as success.
async function refundPayment(paymentId) {
  const id = encodeURIComponent(paymentId);
  const r = await call('POST', `/v5/payments/${id}/refund`);
  if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, text: r.text };
  const p = await call('GET', `/v5/payments/${id}`);
  if (p.status === 200 && p.json && p.json.state === 'Refunded') return { ok: true, status: r.status, text: `already refunded: ${p.text.slice(0, 500)}` };
  return { ok: false, status: r.status, text: r.text };
}

module.exports = { createCheckout, paymentStatus, refundPayment };
