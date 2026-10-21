'use strict';
const fs = require('node:fs');
const path = require('node:path');

function createLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'flow-clone.log');
  const write = (level, msg) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}`;
    (level === 'error' ? console.error : console.log)(line);
    try { fs.appendFileSync(file, line + '\n'); } catch { /* ignore */ }
  };
  return {
    file,
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
  };
}

module.exports = { createLog };
