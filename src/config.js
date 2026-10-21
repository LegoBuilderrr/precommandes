// Settings from the environment, and the paths of the project (the code lives in src/, everything else next to it).
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8443);

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'),   // pictures uploaded from the product editor
  DB_FILE: process.env.DB_FILE || path.join(ROOT, 'data.db'),
  PORT,
  HOST: process.env.HOST || '127.0.0.1',
  PLAIN_HTTP: process.env.PLAIN_HTTP === '1',                         // behind a reverse proxy that already does the TLS
  BASE_URL: process.env.BASE_URL || `https://localhost:${PORT}`,       // public address, possibly with a path prefix
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',                    // empty = open admin (local use only)
};
