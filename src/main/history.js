'use strict';
// Local records: a JSONL dictation history and a JSON dictionary.

const fs = require('node:fs');
const path = require('node:path');

class History {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'history.jsonl');
    this.dictFile = path.join(dir, 'dictionary.json');
    fs.mkdirSync(dir, { recursive: true });
  }

  append(entry) {
    fs.appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  recent(limit = 50) {
    if (!fs.existsSync(this.file)) return [];
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  }

  stats() {
    const rows = this.recent(100000);
    const words = rows.reduce((n, r) => n + (r.words || 0), 0);
    const audioMs = rows.reduce((n, r) => n + (r.audioMs || 0), 0);
    return { dictations: rows.length, words, audioMinutes: Math.round(audioMs / 600) / 100 };
  }

  /** [{word}] or [{from,to}] entries. */
  getDictionary() {
    try { return JSON.parse(fs.readFileSync(this.dictFile, 'utf8')); } catch { return []; }
  }

  setDictionary(entries) {
    fs.writeFileSync(this.dictFile, JSON.stringify(entries, null, 2));
  }

  addWord(word) {
    const d = this.getDictionary();
    if (!d.some((e) => e.word === word)) d.push({ word });
    this.setDictionary(d);
    return d;
  }

  dictionaryWords() {
    return this.getDictionary().map((e) => e.word || e.to).filter(Boolean);
  }
}

module.exports = { History };
