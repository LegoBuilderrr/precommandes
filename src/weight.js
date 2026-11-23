// Weights are stored in grams so totals can be computed; display labels are generated from them.
const trim = (kg) => String(Number(kg.toFixed(3))).replace('.', ',');

// "500gr", "1 kg", "1,5kg", "200 g" -> grams (null when the text is not a weight, e.g. "pièce")
function parseWeight(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr)\s*$/i.exec(String(text || ''));
  if (!m) return null;
  const grams = Math.round(Number(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'kg' ? 1000 : 1));
  return grams >= 1 && grams <= 1e6 ? grams : null;
}
const weightLabel = (g) => (g >= 1000 ? `${trim(g / 1000)}kg` : `${g}gr`);   // 500 -> "500gr", 1000 -> "1kg"
const fmtWeight = (g) => (g >= 1000 ? `${trim(g / 1000)} kg` : `${g} g`);    // for totals: "1,5 kg", "350 g"

// Volumes are stored in millilitres. A size entered in cL or L gets a label like "33cL" / "1,5L".
const trimN = (n) => String(Number(n.toFixed(3))).replace('.', ',');
const volumeLabel = (ml) => (ml >= 1000 ? `${trimN(ml / 1000)}L` : `${trimN(ml / 10)}cL`);   // 330 -> "33cL", 1500 -> "1,5L"
// totals and admin tables always show litres: "0,33 L", "1 250,5 L"
const fmtVolume = (ml) => `${(ml / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/\u202f|\u00a0/g, ' ')} L`;

const unitsLabel = (n) => `${n} unité${n > 1 ? 's' : ''}`;                  // 1 -> "1 unité", 6 -> "6 unités"

module.exports = { parseWeight, weightLabel, fmtWeight, unitsLabel, volumeLabel, fmtVolume };
