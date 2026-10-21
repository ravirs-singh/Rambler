'use strict';
// Deterministic text clean-up that runs whether or not an LLM formatter is
// enabled: spoken punctuation/commands, filler removal, dictionary casing and
// replacements, whitespace, and joining with the surrounding field text.

const SPOKEN = [
  [/\b(new|next) paragraph\b[.,]?/gi, '\n\n'],
  [/\b(new|next) line\b[.,]?/gi, '\n'],
  [/\s*\bfull stop\b/gi, '.'],
  [/\s*\bperiod\b(?=\s|$)/gi, '.'],
  [/\s*\bcomma\b(?=\s|$)/gi, ','],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bexclamation (mark|point)\b/gi, '!'],
  [/\s*\bcolon\b(?=\s|$)/gi, ':'],
  [/\s*\bsemicolon\b/gi, ';'],
  [/\bopen (paren|parenthesis)\b\s*/gi, '('],
  [/\s*\bclose (paren|parenthesis)\b/gi, ')'],
  [/\bopen quote\b\s*/gi, '"'],
  [/\s*\bclose quote\b/gi, '"'],
];

const FILLERS = /\b(um+|uh+|erm+|hmm+|you know,?|like,|I mean,)\s*/gi;

function applySpokenCommands(text) {
  let out = text;
  for (const [re, rep] of SPOKEN) out = out.replace(re, rep);
  return out.replace(/[ \t]*\n[ \t]*/g, '\n');
}

function removeFillers(text) {
  return text.replace(FILLERS, '');
}

/**
 * dictionary: [{word:'Wispr'}, {word:'gRPC'}, {from:'flow clone', to:'Flow Clone'}]
 * Entries with `from`/`to` are replacements; `word` entries enforce casing.
 */
function applyDictionary(text, dictionary = []) {
  let out = text;
  for (const entry of dictionary) {
    if (entry.from && entry.to) {
      out = out.replace(new RegExp(`\\b${escapeRe(entry.from)}\\b`, 'gi'), entry.to);
    } else if (entry.word) {
      out = out.replace(new RegExp(`\\b${escapeRe(entry.word)}\\b`, 'gi'), entry.word);
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tidy(text) {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,!?;:)])/g, '$1')
    .replace(/\( +/g, '(')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function capitalizeSentences(text) {
  return text.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

/**
 * Decide how to glue the text into the field: add a leading space when the
 * caret follows a word character, add trailing space/newline when text follows.
 */
function fitToContext(text, { beforeText = '', afterText = '' } = {}) {
  let out = text;
  const prev = beforeText.slice(-1);
  const next = afterText.slice(0, 1);
  if (prev && /[.!?]\s*$/.test(beforeText) && /^[a-z]/.test(out)) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  if (prev && !/\s|\(|\[|"|'|\n/.test(prev)) {
    out = (/^[,.;:!?)]/.test(out) ? '' : ' ') + out;
  }
  if (next && !/\s/.test(next) && !/[\s(]$/.test(out)) {
    out += ' ';
  }
  return out;
}

function localFormat(text, opts = {}) {
  let out = text;
  out = applySpokenCommands(out);
  if (opts.removeFillers !== false) out = removeFillers(out);
  out = applyDictionary(out, opts.dictionary);
  out = tidy(out);
  out = capitalizeSentences(out);
  if (out && !/[.!?…"')\]]$/.test(out) && !/\n$/.test(out) && opts.addFinalPeriod !== false && out.split(/\s+/).length > 3) {
    out += '.';
  }
  return out;
}

module.exports = { applySpokenCommands, removeFillers, applyDictionary, tidy, capitalizeSentences, fitToContext, localFormat };
