import { env } from '../config/env.js';

export class AIUnavailable extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

/**
 * Hosted LLM call.
 * Supports:
 *   1. Anthropic Messages API  (default)
 *   2. OpenAI-compatible APIs  (Groq, OpenAI, etc.)
 *
 * Detection: if AI_API_URL contains "anthropic" → Anthropic mode,
 * otherwise → OpenAI-compatible mode (Groq etc.).
 *
 * The rest of the app only sees Anthropic-shaped responses:
 *   { content: [{type:'text',text}|{type:'tool_use',id,name,input}], stop_reason }
 */
export async function callLLM({ system, messages, tools, timeoutMs, maxTokens = 900 }) {
  if (!env.aiApiKey) throw new AIUnavailable('not_configured');
  if (timeoutMs <= 0) throw new AIUnavailable('timeout');

  const isAnthropic = /anthropic/i.test(env.aiApiUrl || '');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    if (isAnthropic) {
      return await callAnthropic({ system, messages, tools, maxTokens, signal: ctrl.signal });
    }
    return await callOpenAICompatible({ system, messages, tools, maxTokens, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof AIUnavailable) throw e;
    throw new AIUnavailable(e.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

async function callAnthropic({ system, messages, tools, maxTokens, signal }) {
  const res = await fetch(env.aiApiUrl, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.aiApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.aiModel,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools?.length ? { tools } : {}),
    }),
  });
  if (!res.ok) throw new AIUnavailable(`http_${res.status}`);
  return await res.json();
}

// ─── OpenAI-compatible (Groq, OpenAI, …) ─────────────────────────────────────

async function callOpenAICompatible({ system, messages, tools, maxTokens, signal }) {
  // Build URL – accept both base (.../v1) and full (.../chat/completions)
  let url = env.aiApiUrl.replace(/\/$/, '');
  if (!url.endsWith('/chat/completions')) {
    url = `${url}/chat/completions`;
  }

  // Convert Anthropic-style tools → OpenAI function tools
  const openaiTools = (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));

  // Convert messages (Anthropic content blocks → OpenAI format)
  const openaiMessages = [];
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }

  for (const msg of messages) {
    openaiMessages.push(...toOpenAIMessages(msg));
  }

  const body = {
    model: env.aiModel,
    max_tokens: maxTokens,
    messages: openaiMessages,
    ...(openaiTools.length ? { tools: openaiTools, tool_choice: 'auto' } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.aiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[llmClient] OpenAI-compatible error', res.status, errText.slice(0, 300));
    throw new AIUnavailable(`http_${res.status}`);
  }

  const data = await res.json();
  return fromOpenAIResponse(data);
}

/**
 * Convert one Anthropic-style message into one or more OpenAI messages.
 * Handles:
 *  - plain string content
 *  - array of text / tool_use / tool_result blocks
 */
function toOpenAIMessages(msg) {
  const { role, content } = msg;

  // Simple string content
  if (typeof content === 'string') {
    return [{ role, content }];
  }

  // Array of content blocks
  if (Array.isArray(content)) {
    // Tool results → role: "tool"
    const toolResults = content.filter((b) => b.type === 'tool_result');
    if (toolResults.length) {
      return toolResults.map((b) => ({
        role: 'tool',
        tool_call_id: b.tool_use_id,
        content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
      }));
    }

    // Assistant message that may contain text + tool_use
    if (role === 'assistant') {
      const textParts = content.filter((b) => b.type === 'text').map((b) => b.text);
      const toolUses = content.filter((b) => b.type === 'tool_use');

      const out = {
        role: 'assistant',
        content: textParts.join('\n') || null,
      };

      if (toolUses.length) {
        out.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: {
            name: t.name,
            arguments: JSON.stringify(t.input || {}),
          },
        }));
      }
      return [out];
    }

    // User message with only text blocks
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return [{ role, content: text }];
  }

  return [{ role, content: String(content) }];
}

/**
 * Convert OpenAI chat completion response → Anthropic-shaped object
 * so the rest of aiService.js keeps working unchanged.
 */
function fromOpenAIResponse(data) {
  const choice = data.choices?.[0];
  if (!choice) {
    return { content: [], stop_reason: 'end_turn' };
  }

  const msg = choice.message || {};
  const content = [];

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    for (const tc of msg.tool_calls) {
      let input = {};
      try {
        input = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function?.name,
        input,
      });
    }
  }

  // Map finish_reason → Anthropic stop_reason
  let stop_reason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
  else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';
  else if (choice.finish_reason === 'stop') stop_reason = 'end_turn';

  return { content, stop_reason };
}

export const textOf = (resp) =>
  (resp?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();