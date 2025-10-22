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

async function loadKeyFromLocal(): Promise<string | null> {
  try {
    const data = await chrome.storage.local.get('OPENAI_API_KEY');
    return (data?.OPENAI_API_KEY as string) || null;
  } catch (_) {
    return null;
  }
}

async function saveKeyToLocal(key: string | null) {
  try {
    if (key) await chrome.storage.local.set({ OPENAI_API_KEY: key });
    else await chrome.storage.local.remove('OPENAI_API_KEY');
  } catch (_) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  (async () => {
    try {
      if (msg?.kind === "SET_API_KEY") {
        OPENAI_API_KEY = (msg.key || "").trim() || null;
        const persist = !!msg.persist;
        // Always keep a session copy for immediate use
        await saveKeyToSession(OPENAI_API_KEY);
        // Optionally keep a device copy that survives restarts
        if (persist) await saveKeyToLocal(OPENAI_API_KEY);
        else await saveKeyToLocal(null);
        sendResponse({ ok: !!OPENAI_API_KEY, persisted: persist });
        return;
      }
      if (msg?.kind === "HAS_API_KEY") {
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromSession();
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromLocal();
        sendResponse(!!OPENAI_API_KEY);
        return;
      }
      if (msg?.kind === "GET_KEY_STATUS") {
        const inSession = !!(await loadKeyFromSession());
        const inLocal = !!(await loadKeyFromLocal());
        sendResponse({ hasKey: inSession || inLocal, persisted: inLocal });
        return;
      }
      if (msg?.kind === "CLEAR_API_KEY") {
        OPENAI_API_KEY = null;
        await saveKeyToSession(null);
        await saveKeyToLocal(null);
        sendResponse(true);
        return;
      }
      if (msg?.kind === "ASK_LLM") {
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromSession();
        if (!OPENAI_API_KEY) OPENAI_API_KEY = await loadKeyFromLocal();
        if (!OPENAI_API_KEY) {
          if (sender.tab?.id != null) chrome.tabs.sendMessage(sender.tab.id, { kind: "LLM_ERROR", error: "Missing API key" });
          return;
        }
        const tabId = sender.tab?.id;
        const srcUrl = (sender as any).url || sender.tab?.url || "";
        if (tabId == null) return;
        const { messages, context } = msg.payload || {};
        const tokens = estimateTokens(messages, context);
        enqueue(() => askOpenAI({ messages, context, tabId, srcUrl }), tokens);
        return;
      }
      if (msg?.kind === "GET_STATUS") {
        sendResponse(getStatus());
        return;
      }
      if (msg?.kind === "OPEN_CHATGPT") {
        const url = "https://chat.openai.com/";
        await chrome.tabs.create({ url });
        sendResponse(true);
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
    model: "gpt-4o-mini", // lighter/more available; change if needed
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

// ---------- Simple in-worker rate limiter queue ----------
type QueuedTask = { run: () => Promise<void>; tokens: number };
const queue: QueuedTask[] = [];
let busy = false;
let lastStart = 0;
const MIN_INTERVAL_MS = 1200; // min gap between request starts

// Token buckets (per-minute) — approximate RPM/TPM controls
const WINDOW_MS = 60_000;
const RATE_MAX_RPM = 30;      // adjust to your account limits
const RATE_MAX_TPM = 40_000;  // approximate TPM budget
let rpmRemaining = RATE_MAX_RPM;
let tpmRemaining = RATE_MAX_TPM;
let windowEndsAt = nextWindow();
scheduleNextReset();

function enqueue(task: () => Promise<void>, tokens = 500) {
  queue.push({ run: task, tokens });
  pump();
}

function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  const gap = Date.now() - lastStart;
  const delay = Math.max(0, MIN_INTERVAL_MS - gap);
  busy = true;
  setTimeout(async () => {
    lastStart = Date.now();
    try {
      await awaitBudget(next.tokens);
      await next.run();
    }
    finally { busy = false; pump(); }
  }, delay);
}

async function awaitBudget(tokensNeeded: number) {
  // Ensure per-minute buckets have capacity; if not, wait for the next window
  while (true) {
    const now = Date.now();
    if (now >= windowEndsAt) resetBuckets();
    if (rpmRemaining > 0 && tpmRemaining - tokensNeeded >= 0) {
      rpmRemaining -= 1;
      tpmRemaining -= Math.max(1, tokensNeeded);
      return;
    }
    const wait = Math.max(200, windowEndsAt - now + 100);
    await sleep(wait);
  }
}

function resetBuckets() {
  rpmRemaining = RATE_MAX_RPM;
  tpmRemaining = RATE_MAX_TPM;
  windowEndsAt = nextWindow();
}

function nextWindow() {
  const now = Date.now();
  return now - (now % WINDOW_MS) + WINDOW_MS; // align to next minute boundary
}

function scheduleNextReset() {
  const delay = Math.max(0, nextWindow() - Date.now());
  setTimeout(function tick() {
    resetBuckets();
    scheduleNextReset();
  }, delay);
}

function estimateTokens(messages: any[], context: any): number {
  // Very rough: ~4 chars per token, add small overhead per message
  let chars = 0;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m) continue;
      const s = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      chars += (s || '').length + 20;
    }
  }
  if (context) chars += JSON.stringify(context).length;
  return Math.ceil(chars / 4);
}

function getStatus() {
  return {
    queue: queue.length,
    rpmRemaining,
    tpmRemaining,
    rpmMax: RATE_MAX_RPM,
    tpmMax: RATE_MAX_TPM,
    nextResetMs: Math.max(0, windowEndsAt - Date.now())
  };
}

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
      "If the user asks 'what are the steps to find <thing>' or similar, answer with concise numbered steps (1-4).",
      "When possible, also emit a single JSON block to highlight relevant controls, e.g. search box and a link matching the query:",
      '{"action":"highlight","targets":[{"text":"search","role":"button"},{"text":"<thing>","role":"link"}]}',
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
