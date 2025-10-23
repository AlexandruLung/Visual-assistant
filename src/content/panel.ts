/* Floating panel + messaging + action protocol (no ES modules in content scripts) */
// Inline utilities instead of imports to avoid 'export' errors in content scripts.

type FindQuery = { text?: string; role?: string };
type FindOpts = { strict?: boolean; clickableOnly?: boolean };

function findCandidates(q: FindQuery, opts: FindOpts = {}): HTMLElement[] {
  const text = q.text?.toLowerCase().trim();
  const role = q.role?.toLowerCase().trim();
  const strict = !!opts.strict;
  const clickableOnly = opts.clickableOnly !== false;

  // Special semantic/icon queries (e.g., magnifier/magnifying glass)
  const iconTargets = findSemanticTargets(text || "");
  if (iconTargets.length) return iconTargets;

  const nodes = allElements();
  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  const maxArea = vw * vh * 0.5; // avoid huge wrappers more aggressively
  const minArea = 12; // skip tiny noise elements
  const shortText = !!text && text.length <= 3;

  type Scored = { el: HTMLElement; score: number; area: number };
  const scored: Scored[] = [];
  for (const el of nodes) {
    if (!(el.offsetWidth && el.offsetHeight)) continue; // visible
    const r = el.getBoundingClientRect();
    const area = Math.max(1, r.width * r.height);
    if (area > maxArea || area < minArea) continue; // skip huge or tiny

    const roleAttr = (el.getAttribute("role") || "").toLowerCase();
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    const title = (el.getAttribute("title") || "").toLowerCase();
    const labelText = (el.textContent || "").trim().toLowerCase();

    const clickable = isClickable(el);

    // Short text should only match clickables to reduce noise
    if ((shortText || clickableOnly) && !clickable) continue;

    // Role constraint if provided
    if (role) {
      const roleOk = roleAttr === role ||
        (role === "button" && (el.tagName === "BUTTON" || el.getAttribute("type") === "button")) ||
        (role === "link" && el.tagName === "A");
      if (!roleOk) continue;
    }

    let score = 0;
    if (!text) score += 1; // no text query, allow through
    else {
      const direct = strict ? includePhrase(labelText, text) : labelText.includes(text);
      const meta = strict ? includePhrase(aria, text) || includePhrase(title, text) : (aria.includes(text) || title.includes(text));
      if (direct) score += 6;
      if (meta) score += 4;
    }
    if (clickable) score += 2;
    if (role && roleAttr === role) score += 2;

    // Prefer smaller targets when scores tie
    if (score > 0) scored.push({ el, score: score - Math.log10(area), area });
  }

  scored.sort((a, b) => b.score - a.score || a.area - b.area);
  const picked: HTMLElement[] = [];
  const boxes: DOMRect[] = [];
  for (const s of scored) {
    const rect = s.el.getBoundingClientRect();
    let overlap = false;
    for (const b of boxes) {
      if (rectsOverlap(rect, b)) { overlap = true; break; }
    }
    if (!overlap) {
      picked.push(s.el);
      boxes.push(rect);
    }
    if (picked.length >= 12) break; // cap
  }
  return picked;
}

function includePhrase(hay: string, needle: string) {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(hay).includes(norm(needle));
}

function allElements(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const pushTree = (root: Node | ShadowRoot) => {
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT);
    let n = walker.currentNode as Element | null;
    while (n) {
      out.push(n as HTMLElement);
      const any = n as any;
      if (any.shadowRoot) pushTree(any.shadowRoot);
      n = walker.nextNode() as Element | null;
    }
  };
  pushTree(document);
  return out;
}

function isClickable(el: HTMLElement): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') return true;
  const tabIndex = el.getAttribute('tabindex');
  if (tabIndex && parseInt(tabIndex, 10) >= 0) return true;
  return false;
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const overlapArea = xOverlap * yOverlap;
  const minArea = Math.min(a.width * a.height, b.width * b.height);
  return overlapArea / Math.max(1, minArea) > 0.7;
}

function findSemanticTargets(text: string): HTMLElement[] {
  const t = (text || '').toLowerCase().trim();
  if (!t) return [];

  const iconMap: Record<string, string[]> = {
    search: ['search', 'magnifier', 'magnifying glass', 'loupe', 'lupa', 'cauta', 'căut', 'caut'],
    mic: ['mic', 'microphone', 'voice', 'vocal', 'microfon'],
    camera: ['camera', 'image', 'photo', 'lens'],
    keyboard: ['keyboard', 'input tools', 'virtual keyboard'],
    clear: ['clear', 'x', 'close', 'remove', 'sterge', 'șterge'],
    settings: ['settings', 'gear', 'preferences'],
    apps: ['apps', 'grid', 'app launcher']
  };

  function matchKey(): string | null {
    for (const [key, words] of Object.entries(iconMap)) {
      for (const w of words) {
        if (t.includes(w)) return key;
      }
    }
    if (/icon\s*search|search\s*icon/.test(t)) return 'search';
    return null;
  }

  const key = matchKey();
  if (!key) return [];

  const candidates: HTMLElement[] = [];
  const push = (el: Element | null) => {
    if (!el) return;
    const e = el as HTMLElement;
    if (!(e.offsetWidth && e.offsetHeight)) return;
    const svg = e.querySelector('svg') as HTMLElement | null;
    const target = pickSmallerTarget(e, svg);
    candidates.push(target);
  };

  const byLabels = (words: string[]) => {
    for (const w of words) {
      const sel = `*[aria-label*="${w}" i], *[title*="${w}" i], *[data-tooltip*="${w}" i]`;
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        if (!(el.offsetWidth && el.offsetHeight)) return;
        if (!isClickable(el)) {
          const parent = el.closest('button, [role="button"], a, input');
          if (parent) el = parent as HTMLElement;
        }
        const r = el.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > 2500) {
          const svg = el.querySelector('svg') as HTMLElement | null;
          if (svg) el = svg;
        }
        candidates.push(el);
      });
    }
  };

  switch (key) {
    case 'search': {
      ['input[type="search"]', 'input[name="q"]', '[role="search"] input']
        .forEach((s) => document.querySelectorAll<HTMLElement>(s).forEach((el) => push(el)));
      byLabels(iconMap.search);
      break;
    }
    case 'mic': {
      byLabels(iconMap.mic.concat(['search by voice']));
      break;
    }
    case 'camera': {
      byLabels(iconMap.camera.concat(['search by image', 'google lens']));
      break;
    }
    case 'keyboard': {
      byLabels(iconMap.keyboard);
      break;
    }
    case 'clear': {
      byLabels(iconMap.clear);
      // also try small buttons near the search input
      document.querySelectorAll<HTMLElement>('input[name="q"], input[type="search"]').forEach((inp) => {
        const btn = inp.parentElement?.querySelector('button,[role="button"]') as HTMLElement | null;
        if (btn && btn.offsetWidth < 48 && btn.offsetHeight < 48) push(btn);
      });
      break;
    }
    case 'settings': {
      byLabels(iconMap.settings);
      break;
    }
    case 'apps': {
      byLabels(iconMap.apps.concat(['google apps']));
      break;
    }
  }

  return Array.from(new Set(candidates)).slice(0, 6);
}

function pickSmallerTarget(root: HTMLElement, svg: HTMLElement | null): HTMLElement {
  if (!svg) return root;
  const rr = root.getBoundingClientRect();
  const rs = svg.getBoundingClientRect();
  const ar = rr.width * rr.height;
  const as = rs.width * rs.height;
  if (as > 0 && as * 2 < ar) return svg;
  return root;
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
  const status = document.createElement("div");
  status.className = "aws-assist-status";
  const btnHighlight = document.createElement("button");
  btnHighlight.textContent = "Highlight";
  const strictWrap = document.createElement("label");
  strictWrap.style.display = "inline-flex";
  strictWrap.style.alignItems = "center";
  strictWrap.style.gap = "4px";
  strictWrap.style.color = "#9ca3af";
  const strictCb = document.createElement("input");
  strictCb.type = "checkbox";
  strictWrap.appendChild(strictCb);
  strictWrap.appendChild(document.createTextNode("Strict"));
  const btnCapture = document.createElement("button");
  btnCapture.textContent = "Capture Tab";
  const btnScan = document.createElement("button");
  btnScan.textContent = "Scan Page";
  const btnHandoff = document.createElement("button");
  btnHandoff.textContent = "Open ChatGPT";
  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear";
  toolbar.append(btnHighlight, strictWrap, btnCapture, btnScan, btnHandoff, btnClear);
  panel.appendChild(toolbar);
  panel.appendChild(status);

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
    if (!text) {
      renderSystemNote(chat, "Type a word visible on the page, then click Highlight.");
      return;
    }
    const els = findCandidates({ text, role: undefined }, { strict: !!strictCb.checked, clickableOnly: true });
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

  btnHandoff.onclick = async () => {
    const summary = buildHandoffSummary();
    try {
      await navigator.clipboard.writeText(summary);
      renderSystemNote(chat, "Copied summary to clipboard. Opening ChatGPT — paste with Ctrl+V.");
    } catch (_) {
      renderSystemNote(chat, "Opening ChatGPT. If clipboard blocked, copy manually from the panel.");
    }
    chrome.runtime.sendMessage({ kind: 'OPEN_CHATGPT' });
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

  // start status polling
  startStatusPolling(status);
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

  // Local fallback for "steps to find <thing>" to avoid 429s
  const findIntent = parseFindStepsIntent(text);
  if (findIntent) {
    STATE.messages.push({ role: "user", content: text });
    renderUser(chat, text);
    renderAssistantDelta(chat, "");
    const plan = localFindPlan(findIntent);
    renderAssistantDelta(chat, plan);
    // Try to highlight the search box immediately
    const targets = findSemanticTargets('search icon');
    if (targets.length) highlightElements(targets, 'Search');
    if (currentAssistantEl) currentAssistantEl.setAttribute("data-closed", "1");
    return;
  }

  // Local small-talk response to avoid 429 and keep UX snappy
  const small = smallTalkReply(text);
  if (small) {
    STATE.messages.push({ role: "user", content: text });
    renderUser(chat, text);
    renderAssistantDelta(chat, "");
    renderAssistantDelta(chat, small);
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
  const persistLabel = document.createElement("label");
  persistLabel.style.marginLeft = "6px";
  persistLabel.style.fontSize = "12px";
  persistLabel.style.display = "inline-flex";
  persistLabel.style.alignItems = "center";
  const persist = document.createElement("input");
  persist.type = "checkbox";
  persist.style.marginRight = "4px";
  persistLabel.appendChild(persist);
  persistLabel.appendChild(document.createTextNode("Remember on this device"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") setApiKey(input.value, persist.checked);
  });
  const btn = document.createElement("button");
  btn.textContent = "Set";
  btn.onclick = () => setApiKey(input.value, persist.checked);
  wrap.append(input, btn, persistLabel);
  chat.appendChild(wrap);
}

function setApiKey(val: string, persist = false) {
  const key = (val || "").trim();
  if (!key) return;
  chrome.runtime.sendMessage({ kind: "SET_API_KEY", key, persist }, (res: any) => {
    STATE.hasApiKey = !!(res && res.ok);
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

function buildHandoffSummary(): string {
  const lastUser = [...STATE.messages].reverse().find(m => m.role === 'user')?.content || '';
  const hints = STATE.domHints.slice(0, 15);
  const parts = [
    lastUser ? `Question: ${lastUser}` : 'Question: (none yet)',
    hints.length ? `Visible items: ${hints.join(' | ')}` : 'Visible items: (scan with the extension for more)'
  ];
  return parts.join('\n');
}

function startStatusPolling(statusEl: HTMLElement) {
  async function tick() {
    try {
      chrome.runtime.sendMessage({ kind: 'GET_STATUS' }, (st: any) => {
        if (!st) return;
        const secs = Math.ceil((st.nextResetMs || 0) / 1000);
        statusEl.textContent = `Queue: ${st.queue || 0} | RPM: ${st.rpmRemaining}/${st.rpmMax} | TPM: ${st.tpmRemaining}/${st.tpmMax} | Next: ${secs}s`;
      });
    } catch (_) { /* ignore */ }
  }
  tick();
  setInterval(tick, 2000);
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

function parseFindStepsIntent(t: string): string | null {
  const s = t.trim().toLowerCase();
  const re = /(steps\s+to\s+find|how\s+to\s+find|find\s+steps\s+for)\s+(.+)/i;
  const m = s.match(re);
  if (m && m[2]) return m[2].trim();
  return null;
}

function localFindPlan(target: string): string {
  const q = target.replace(/^the\s+/, '');
  return [
    `1) Click the search box.`,
    `2) Type: ${q}`,
    `3) Press Enter to search.`,
    `4) Click the result that matches "${q}" (e.g., the official site).`
  ].join('\n');
}

function smallTalkReply(t: string): string | null {
  const s = t.trim().toLowerCase();
  const hello = /^(hi|hello|hey|yo|good\s*(morning|afternoon|evening))\b/.test(s);
  const how = /(how\s*(are|r)\s*you|how\s*you\s*doing|what's\s*up|sup)\b/.test(s);
  if (hello && how) return "Doing well! How can I help—highlight something on this page, scan it for hints, or answer a quick AWS/Google question?";
  if (hello) return "Hi! I can highlight items on this page, scan it for hints, or walk you through AWS/Google tasks. What should we do?";
  if (how) return "I'm good—ready to help. Tell me what to find or ask a question about AWS or your current Google results.";
  return null;
}
