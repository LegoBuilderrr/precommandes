// HTML templates (plain strings), split by audience: shop = customers, admin = the back office.
const { layout } = require('./common');
const shop = require('./shop');
const admin = require('./admin');

module.exports = { layout, ...shop, ...admin };
