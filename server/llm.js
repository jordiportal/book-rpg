// Configuración del LLM (litellm -> ollama.khlloreda.com)
export const LLM_CONFIG = {
  baseUrl: 'https://ollama.khlloreda.com/v1',
  apiKey: 'sk-litellm-8d13346fba6cd9a78eee874cb8ef4e88bf6c4921',
  model: 'deepseek-v4-flash',
  temperature: 0.8,
  maxTokens: 900
};

// Llamada genérica al chat completions
export async function chatLLM({ system, messages, temperature, maxTokens }) {
  const body = {
    model: LLM_CONFIG.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages
    ],
    temperature: temperature ?? LLM_CONFIG.temperature,
    max_tokens: maxTokens ?? LLM_CONFIG.maxTokens,
    stream: false
  };

  const res = await fetch(`${LLM_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_CONFIG.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM error ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}
