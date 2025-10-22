// MV3 service worker: OpenAI routing, streaming, and action extraction
let OPENAI_API_KEY: string | null = null; // in-memory cache

async function loadKeyFromSession(): Promise<string | null> {
  try {
    const data = await chrome.storage.session.get('OPENAI_API_KEY');
    return (data?.OPENAI_API_KEY as string) || null;
  } catch (_) {
    return null;
  }
}

async function saveKeyToSession(key: string | null) {
  try {
    if (key) await chrome.storage.session.set({ OPENAI_API_KEY: key });
    else await chrome.storage.session.remove('OPENAI_API_KEY');
  } catch (_) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  (async () => {
    try {
      if (msg?.kind === "SET_API_KEY") {
        OPENAI_API_KEY = (msg.key || "").trim() || null;
        await saveKeyToSession(OPENAI_API_KEY);
        sendResponse(!!OPENAI_API_KEY);
        return;
      }
      if (msg?.kind === "HAS_API_KEY") {
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromSession();
        sendResponse(!!OPENAI_API_KEY);
        return;
      }
      if (msg?.kind === "ASK_LLM") {
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromSession();
        if (!OPENAI_API_KEY) {
          if (sender.tab?.id != null) chrome.tabs.sendMessage(sender.tab.id, { kind: "LLM_ERROR", error: "Missing API key" });
          return;
        }
        const tabId = sender.tab?.id;
        const srcUrl = (sender as any).url || sender.tab?.url || "";
        if (tabId == null) return;
        const { messages, context } = msg.payload || {};
        await askOpenAI({ messages, context, tabId, srcUrl });
        return;
      }
    } catch (e: any) {
      try { sendResponse(false); } catch (_) { /* ignore */ }
    }
  })();
  return true; // keep the message channel alive for async sendResponse
});

async function askOpenAI({ messages, context, tabId, srcUrl }: any) {
  const sys = {
    role: "system",
    content: buildSystemPrompt(srcUrl)
  };

  const body = {
    model: "gpt-5", // replace with actual model name when available
    messages: [sys, ...(messages || []), { role: "system", content: JSON.stringify({ context }) }],
    stream: true
  };

  try {
    const { fullText } = await fetchWithBackoff(body);
    await chrome.tabs.sendMessage(tabId, { kind: "LLM_DONE", fullText });

    // Try to extract action JSON and forward separately
    try {
      const m = fullText.match(/\{[\s\S]*\}/);
      if (m) {
        const obj = JSON.parse(m[0]);
        if (obj && obj.action) {
          await chrome.tabs.sendMessage(tabId, { kind: "LLM_ACTION", action: obj });
        }
      }
    } catch (_) { /* noop */ }
  } catch (err: any) {
    // Fallback heuristic: if the last user message looks like highlight, emulate an action
    try {
      const last = Array.isArray(messages) ? messages[messages.length - 1]?.content || "" : "";
      const textMatch = String(last).match(/highlight\s+([\w\s\-\/]+)$/i);
      if (textMatch && tabId != null) {
        await chrome.tabs.sendMessage(tabId, {
          kind: "LLM_ACTION",
          action: { action: "highlight", targets: [{ text: textMatch[1].trim(), role: "button" }] }
        });
        await chrome.tabs.sendMessage(tabId, { kind: "LLM_ERROR", error: `Network error, simulated action. (${err?.message || err})` });
        return;
      }
    } catch (_) { /* ignore */ }
    if (tabId != null) await chrome.tabs.sendMessage(tabId, { kind: "LLM_ERROR", error: String(err?.message || err) });
  }
}

async function* parseSSE(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const obj = JSON.parse(data);
          const token = obj?.choices?.[0]?.delta?.content;
          if (token) yield token as string;
        } catch (_) {
          // ignore bad JSON lines
        }
      }
    }
  }
  // flush
  if (buffer.length) {
    const lines = buffer.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const obj = JSON.parse(data);
        const token = obj?.choices?.[0]?.delta?.content;
        if (token) yield token as string;
      } catch (_) { /* noop */ }
    }
  }
}

async function fetchWithBackoff(body: any): Promise<{ fullText: string }> {
  const url = "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`
  };
  const attempts = 3;
  let delay = 1500;
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (resp.status === 429) {
        lastErr = new Error("429 rate limit");
        const ra = resp.headers.get('retry-after');
        const extra = ra ? parseInt(ra, 10) * 1000 : delay;
        await sleep(extra);
        delay *= 2;
        continue;
      }
      if (!resp.ok || !resp.body) throw new Error(`${resp.status} ${resp.statusText}`);
      let fullText = "";
      for await (const delta of parseSSE(resp.body)) {
        const chunk = typeof delta === "string" ? delta : String(delta);
        fullText += chunk;
      }
      return { fullText };
    } catch (e) {
      lastErr = e;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw lastErr || new Error("OpenAI request failed");
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function buildSystemPrompt(url: string): string {
  let mode: "aws" | "google" | "generic" = "generic";
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h.includes("console.aws.amazon.com") || h.endsWith("amazonaws.cn")) mode = "aws";
    else if (h.includes("google.")) mode = "google";
  } catch (_) {
    // ignore
  }

  if (mode === "aws") {
    return [
      "You are an AWS learning coach.",
      "Be concise with steps and gotchas.",
      "When the user asks to show or locate UI, emit a single JSON block only:",
      '{"action":"highlight","targets":[{"text":"...","role":"button|link"}]}',
      "Avoid hallucinating selectors; prefer visible text/labels.",
      "Otherwise respond normally."
    ].join("\n");
  }

  if (mode === "google") {
    return [
      "You are a Google Search assistant.",
      "Summarize top results, suggest query refinements and site: filters.",
      "When asked to show or locate items on the page, emit a single JSON block only:",
      '{"action":"highlight","targets":[{"text":"...","role":"link"}]}',
      "Targets should use visible link text such as result titles, tools (e.g., 'Tools', 'Images'), or filters.",
      "Do not fabricate DOM selectors."
    ].join("\n");
  }

  return [
    "You are a helpful web assistant.",
    "When asked to show or locate UI, emit one JSON block:",
    '{"action":"highlight","targets":[{"text":"...","role":"button|link"}]}',
    "Otherwise respond concisely."
  ].join("\n");
}
