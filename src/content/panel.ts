/* Floating panel + messaging + action protocol (no ES modules in content scripts) */
// Inline utilities instead of imports to avoid 'export' errors in content scripts.

type FindQuery = { text?: string; role?: string };

function findCandidates(q: FindQuery): HTMLElement[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("*"));
  const text = q.text?.toLowerCase().trim();
  const role = q.role?.toLowerCase().trim();
  return nodes.filter((el) => {
    if (!(el.offsetWidth && el.offsetHeight)) return false; // visible
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const labelText = (el.textContent || "").trim().toLowerCase();
    const roleAttr = (el.getAttribute("role") || "").toLowerCase();
    const roleOk = role
      ? roleAttr === role ||
        (role === "button" && (el.tagName === "BUTTON" || el.getAttribute("type") === "button")) ||
        (role === "link" && el.tagName === "A")
      : true;
    const textOk = text ? labelText.includes(text) || aria.includes(text) || title.includes(text) : true;
    return roleOk && textOk;
  });
}

function normalizeTargets(input: Array<{ text?: string; role?: string }>): FindQuery[] {
  return input.map((t) => ({ text: t.text?.trim(), role: t.role?.trim() }));
}

function highlightElements(els: HTMLElement[], label = "Target") {
  cleanupHighlights();
  els.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "aws-assist-highlight";
    Object.assign((overlay.style as any), {
      position: "absolute",
      left: `${r.left + window.scrollX}px`,
      top: `${r.top + window.scrollY}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      outline: "3px solid #22c55e",
      borderRadius: "8px",
      zIndex: 2147483647,
      pointerEvents: "none",
      boxShadow: "0 0 0 4px rgba(34,197,94,0.2)",
      animation: "awsAssistPulse 1.6s infinite"
    });
    const tag = document.createElement("div");
    tag.textContent = `${label} ${idx + 1}`;
    Object.assign((tag.style as any), {
      position: "absolute",
      top: "-28px",
      left: "0",
      padding: "4px 8px",
      background: "#22c55e",
      color: "white",
      borderRadius: "6px",
      fontSize: "12px",
      fontFamily: "ui-sans-serif, system-ui"
    });
    overlay.appendChild(tag);
    document.body.appendChild(overlay);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function cleanupHighlights() {
  document.querySelectorAll(".aws-assist-highlight").forEach((n) => n.remove());
}

async function captureAndOCR(): Promise<string[]> {
  // Stub for now; integrate Tesseract later
  return [];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const STATE = {
  open: false,
  messages: [] as ChatMessage[],
  domHints: [] as string[],
  ocrHints: [] as string[],
  hasApiKey: false
};

const HOTKEY = { altKey: true, key: "j" } as const; // Alt+J

function createPanel() {
  if (document.getElementById("aws-assist-panel")) return;
  const panel = document.createElement("div");
  panel.id = "aws-assist-panel";
  panel.className = "aws-assist-panel";

  // header
  const header = document.createElement("div");
  header.className = "aws-assist-panel-header";
  header.innerHTML = `<div class="aws-assist-panel-title">AWS Learning Assistant</div>`;
  panel.appendChild(header);

  // chat area
  const chat = document.createElement("div");
  chat.className = "aws-assist-chat";
  panel.appendChild(chat);

  // toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "aws-assist-toolbar";
  const btnHighlight = document.createElement("button");
  btnHighlight.textContent = "Highlight";
  const btnCapture = document.createElement("button");
  btnCapture.textContent = "Capture Tab";
  const btnScan = document.createElement("button");
  btnScan.textContent = "Scan Page";
  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear";
  toolbar.append(btnHighlight, btnCapture, btnScan, btnClear);
  panel.appendChild(toolbar);

  // input
  const inputWrap = document.createElement("div");
  inputWrap.className = "aws-assist-input";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Ask about AWS, or say 'highlight Create role'...";
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  inputWrap.append(input, sendBtn);
  panel.appendChild(inputWrap);

  document.body.appendChild(panel);

  // draggable header
  makeDraggable(panel, header);

  // key gate inline when needed
  renderSystemNote(chat, "Press Alt+J to toggle. No data is persisted.");
  checkApiKey().then((has) => {
    STATE.hasApiKey = has;
    if (!has) renderApiKeyPrompt(chat);
  });

  // wire buttons
  btnClear.onclick = () => {
    STATE.messages = [];
    chat.innerHTML = "";
    cleanupHighlights();
  };

  btnHighlight.onclick = () => {
    const text = input.value.trim();
    if (!text) return;
    const els = findCandidates({ text });
    if (els.length) highlightElements(els, "Match");
    else renderSystemNote(chat, `No visible elements containing \"${text}\"`);
  };

  btnCapture.onclick = async () => {
    const hints = await captureAndOCR();
    STATE.ocrHints = hints;
    renderSystemNote(chat, `OCR keywords captured: ${hints.slice(0, 10).join(", ") || "(none)"}`);
  };

  btnScan.onclick = () => {
    STATE.domHints = collectDomHints();
    renderSystemNote(chat, `DOM hints: ${STATE.domHints.slice(0, 10).join(", ") || "(none)"}`);
  };

  sendBtn.onclick = () => sendPrompt(input, chat);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendPrompt(input, chat);
  });

  // receive streaming deltas and actions
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.kind === "LLM_DELTA") {
      renderAssistantDelta(chat, msg.delta || "");
    } else if (msg?.kind === "LLM_DONE") {
      if (typeof msg.fullText === "string") tryExtractAndAct(msg.fullText);
    } else if (msg?.kind === "LLM_ACTION") {
      tryRunAction(msg.action);
    } else if (msg?.kind === "LLM_ERROR") {
      renderSystemNote(chat, `Error: ${msg.error}`);
    }
  });
}

function sendPrompt(input: HTMLInputElement, chat: HTMLDivElement) {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  // Local handling for visibility/context queries without LLM
  if (isLocalScanQuery(text)) {
    const report = buildLocalContextReport();
    STATE.messages.push({ role: "user", content: text });
    renderUser(chat, text);
    renderAssistantDelta(chat, "");
    renderAssistantDelta(chat, report);
    if (currentAssistantEl) currentAssistantEl.setAttribute("data-closed", "1");
    return;
  }
  STATE.messages.push({ role: "user", content: text });
  renderUser(chat, text);
  renderAssistantDelta(chat, ""); // start a new assistant bubble for streaming

  const payload = {
    messages: STATE.messages,
    context: { domHints: STATE.domHints, ocrHints: STATE.ocrHints }
  };

  chrome.runtime.sendMessage({ kind: "ASK_LLM", payload });
}

function renderApiKeyPrompt(chat: HTMLDivElement) {
  const wrap = document.createElement("div");
  wrap.className = "aws-assist-msg system";
  wrap.textContent = "Enter your OpenAI API key (kept in memory only): ";
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "sk-...";
  input.style.marginLeft = "6px";
  input.style.width = "65%";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setApiKey(input.value);
  });
  const btn = document.createElement("button");
  btn.textContent = "Set";
  btn.onclick = () => setApiKey(input.value);
  wrap.append(input, btn);
  chat.appendChild(wrap);
}

function setApiKey(val: string) {
  const key = (val || "").trim();
  if (!key) return;
  chrome.runtime.sendMessage({ kind: "SET_API_KEY", key }, (ok: any) => {
    STATE.hasApiKey = !!ok;
  });
}

function checkApiKey(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ kind: "HAS_API_KEY" }, (v: any) => resolve(!!v));
  });
}

function renderUser(chat: HTMLDivElement, text: string) {
  const d = document.createElement("div");
  d.className = "aws-assist-msg user";
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

let currentAssistantEl: HTMLDivElement | null = null;
function renderAssistantDelta(chat: HTMLDivElement, delta: string) {
  if (!currentAssistantEl || currentAssistantEl.getAttribute("data-closed") === "1") {
    currentAssistantEl = document.createElement("div");
    currentAssistantEl.className = "aws-assist-msg assistant";
    chat.appendChild(currentAssistantEl);
  }
  if (delta) currentAssistantEl!.textContent = (currentAssistantEl!.textContent || "") + delta;
  chat.scrollTop = chat.scrollHeight;
}

function renderSystemNote(chat: HTMLDivElement, text: string) {
  const d = document.createElement("div");
  d.className = "aws-assist-msg system";
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function tryExtractAndAct(fullText: string) {
  // Look for a JSON block that includes an "action" field
  try {
    const m = fullText.match(/\{[\s\S]*\}/);
    if (!m) return;
    const obj = JSON.parse(m[0]);
    tryRunAction(obj);
  } catch (_) {
    // ignore
  } finally {
    if (currentAssistantEl) currentAssistantEl.setAttribute("data-closed", "1");
  }
}

function tryRunAction(action: any) {
  if (action?.action === "highlight" && Array.isArray(action.targets)) {
    const queries = normalizeTargets(action.targets);
    const results = queries.flatMap((q) => findCandidates(q));
    if (results.length) highlightElements(results, "Target");
  }
}

function makeDraggable(panel: HTMLElement, handle: HTMLElement) {
  let sx = 0, sy = 0, px = 0, py = 0, dragging = false;
  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = panel.getBoundingClientRect();
    px = r.left; py = r.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    panel.style.left = `${px + dx}px`;
    panel.style.top = `${py + dy}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  window.addEventListener("mouseup", () => { dragging = false; });
}

function togglePanel() {
  STATE.open = !STATE.open;
  const existing = document.getElementById("aws-assist-panel");
  if (STATE.open && !existing) createPanel();
  if (existing) existing.style.display = STATE.open ? "flex" : "none";
}

// Hotkey: Alt+J
window.addEventListener("keydown", (e) => {
  if (e.altKey === HOTKEY.altKey && e.key.toLowerCase() === HOTKEY.key) {
    togglePanel();
  }
});

// Auto-create but hidden; toggle shows it
createPanel();
document.getElementById("aws-assist-panel")!.style.display = "none";

function collectDomHints(): string[] {
  const sels = [
    'a', 'button', '[role="button"]', '[role="link"]', 'h1', 'h2', 'h3'
  ];
  const els = Array.from(document.querySelectorAll<HTMLElement>(sels.join(',')));
  const visible = (el: HTMLElement) => el.offsetWidth > 0 && el.offsetHeight > 0;
  const texts = els
    .filter(visible)
    .map(e => (e.textContent || '').trim())
    .filter(t => t.length >= 2 && t.length <= 120);
  return Array.from(new Set(texts)).slice(0, 100);
}

function isLocalScanQuery(t: string): boolean {
  const s = t.toLowerCase();
  return (
    s.includes("what can you see") ||
    s.includes("what do you see") ||
    s.includes("scan page") ||
    s.includes("list links") ||
    s.includes("list buttons")
  );
}

function buildLocalContextReport(): string {
  const linkEls = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'))
    .filter((e) => e.offsetWidth && e.offsetHeight)
    .map((e) => (e.textContent || '').trim())
    .filter(Boolean);
  const btnEls = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'))
    .filter((e) => e.offsetWidth && e.offsetHeight)
    .map((e) => (e.textContent || '').trim())
    .filter(Boolean);
  const heads = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3'))
    .filter((e) => e.offsetWidth && e.offsetHeight)
    .map((e) => (e.textContent || '').trim())
    .filter(Boolean);

  const dedup = (arr: string[], n = 15) => Array.from(new Set(arr)).filter((t) => t.length <= 120).slice(0, n);
  const links = dedup(linkEls, 12);
  const buttons = dedup(btnEls, 10);
  const headings = dedup(heads, 8);

  const lines: string[] = [];
  if (headings.length) lines.push(`Headings: ${headings.join(' | ')}`);
  if (links.length) lines.push(`Links: ${links.join(' | ')}`);
  if (buttons.length) lines.push(`Buttons: ${buttons.join(' | ')}`);
  if (!lines.length) lines.push("I don't see visible headings, links, or buttons.");
  return lines.join('\n');
}
