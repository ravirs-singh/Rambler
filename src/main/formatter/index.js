'use strict';
// LLM formatting step: turns a raw transcript into text that fits the field it
// is going into (punctuation, casing, lists, tone, dictionary spellings, and
// spoken edits like "scratch that"). Runs on Claude through the Anthropic SDK.

const { buildPrompt } = require('./prompt');

const SYSTEM = `You are the formatting stage of a voice dictation tool. The user spoke a message; a speech recognizer produced a raw transcript. Rewrite the transcript into the text the user intended to type, and output nothing else.

Rules:
- Keep the user's words and meaning. Do not answer questions, add content, or address the user.
- Fix punctuation, capitalization, numbers, and obvious recognition errors. Remove filler words and false starts. Apply spoken self-corrections ("no wait", "scratch that", "I mean").
- Honor spoken formatting: "new line", "new paragraph", "bullet list", "number one ... number two".
- Use the exact spelling of any dictionary words that were spoken.
- Match the register and language of the surrounding text and the target application: terse and lowercase-tolerant in chat and terminals, complete sentences in email and documents. If a style is given, follow it.
- The text is inserted at the caret between BEFORE and AFTER. Do not repeat them; do not add leading or trailing whitespace; continue the sentence if the caret is mid-sentence.
- If the transcript is empty or unintelligible, output an empty string.
- Output plain text only (no markdown fences, no quotes around the result).`;

let clientPromise = null;
function getClient(apiKey) {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk').then(({ default: Anthropic }) =>
      new Anthropic(apiKey ? { apiKey } : {}),
    );
  }
  return clientPromise;
}

async function formatWithAnthropic(transcript, context, settings, log) {
  const client = await getClient(settings.apiKey);
  const user = buildPrompt(transcript, context);
  const response = await client.beta.messages.create(
    {
      model: settings.model || 'claude-opus-5-5',
      max_tokens: 4096, // dictation output is deliberately short
      output_config: { effort: settings.effort || 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    },
    { timeout: settings.timeoutMs || 8000, maxRetries: 1 },
  );
  if (response.stop_reason === 'refusal') {
    log.warn('formatter refused; using local formatting');
    return null;
  }
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text.replace(/^```[a-z]*\n?|\n?```$/g, '');
}

/**
 * Returns formatted text or null when the LLM step is disabled/unavailable,
 * in which case the caller keeps the locally formatted text.
 */
async function format(transcript, context, formatterCfg, secretResolver, log) {
  if (formatterCfg.provider !== 'anthropic') return null;
  if (!transcript.trim()) return '';
  if (transcript.trim().split(/\s+/).length < (formatterCfg.minWordsForLlm ?? 1)) return null;
  const settings = { ...formatterCfg.anthropic };
  settings.apiKey = secretResolver(settings.apiKey, 'ANTHROPIC_API_KEY');
  try {
    return await formatWithAnthropic(transcript, { ...context, style: formatterCfg.style }, settings, log);
  } catch (e) {
    log.warn(`formatter failed (${e?.constructor?.name || 'Error'}): ${e.message}`);
    return null;
  }
}

module.exports = { format, SYSTEM };
