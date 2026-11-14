// Minimal LLM client over fetch (no SDK dependencies). Providers: anthropic | openai | gemini.
// Selection: CONTENT_LLM = auto (default) | anthropic | openai | gemini | template.
// "auto" picks the first provider with a key set: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY.

const DEFAULT_TIMEOUT_MS = 6000;

export function pickLLM(env = process.env) {
  const mode = (env.CONTENT_LLM || 'auto').toLowerCase();
  if (mode === 'template' || mode === 'off' || mode === 'none') return null;
  const avail = {
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    gemini: env.GEMINI_API_KEY,
  };
  const name = mode === 'auto' ? Object.keys(avail).find((k) => avail[k]) : mode;
  if (!name || !avail[name]) return null;
  const timeoutMs = Number(env.CONTENT_LLM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const model = {
    anthropic: env.CONTENT_MODEL || 'claude-haiku-5-5',
    openai: env.OPENAI_CONTENT_MODEL || 'gpt-4o-mini',
    gemini: env.GEMINI_CONTENT_MODEL || 'gemini-2.0-flash',
  }[name];
  return { name, model, complete: (args) => complete(name, model, avail[name], timeoutMs, args) };
}

async function complete(provider, model, key, timeoutMs, { system, user, maxTokens = 300 }) {
  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  if (provider === 'anthropic') {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
    const j = await okJson(res, provider);
    return (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }
  if (provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j = await okJson(res, provider);
    return (j.choices?.[0]?.message?.content ?? '').trim();
  }
  if (provider === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
      }),
    });
    const j = await okJson(res, provider);
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  }
  throw new Error(`Unknown LLM provider ${provider}`);
}

async function okJson(res, provider) {
  if (!res.ok) throw new Error(`${provider} LLM HTTP ${res.status}`);
  return res.json();
}
