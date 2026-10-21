'use strict';
// Builds the user turn for the formatter. Pure function, unit tested.

function clip(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(s.length - n) : s;
}

function clipHead(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

function buildPrompt(transcript, ctx = {}) {
  const lines = [];
  if (ctx.appName) lines.push(`APP: ${ctx.appName}${ctx.windowTitle ? ` (${ctx.windowTitle})` : ''}`);
  if (ctx.style && ctx.style !== 'auto') lines.push(`STYLE: ${ctx.style}`);
  if (ctx.language) lines.push(`LANGUAGE: ${ctx.language}`);
  if (Array.isArray(ctx.dictionary) && ctx.dictionary.length) {
    lines.push(`DICTIONARY: ${ctx.dictionary.slice(0, 200).join(', ')}`);
  }
  if (ctx.selectedText) lines.push(`SELECTED (will be replaced): <<<${clipHead(ctx.selectedText, 800)}>>>`);
  lines.push(`BEFORE: <<<${clip(ctx.beforeText, 600)}>>>`);
  lines.push(`AFTER: <<<${clipHead(ctx.afterText, 300)}>>>`);
  lines.push(`TRANSCRIPT: <<<${transcript.trim()}>>>`);
  return lines.join('\n');
}

module.exports = { buildPrompt };
