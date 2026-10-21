// What HelloAsso says about an order: refresh its status from the checkout, read the stored payment details.
const db = require('./db');
const ha = require('./helloasso');

// Asks HelloAsso whether a still-pending order has been paid, and stores the answer. Returns the order's status.
async function refreshOrder(o) {
  if (['paid', 'refunding', 'refunded'].includes(o.status) || !o.intent_id) return o.status;
  const { paid, raw } = await ha.paymentStatus(o.intent_id, o.total_cents);
  const status = paid ? 'paid' : o.status;
  db.prepare("UPDATE orders SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') END, ha_raw = ? WHERE id = ?")
    .run(status, status, raw.slice(0, 8000), o.id);
  return status;
}

// Payment details HelloAsso returned for this checkout (stored raw by refreshOrder), or null.
function paymentInfo(o) {
  try {
    const p = ((JSON.parse(o.ha_raw || '').order || {}).payments || [])[0];
    return p ? { receipt: p.paymentReceiptUrl, date: p.date, means: p.paymentMeans, id: p.id } : null;
  } catch { return null; }
}

module.exports = { refreshOrder, paymentInfo };
