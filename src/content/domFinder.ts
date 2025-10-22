export type FindQuery = { text?: string; role?: string };

export function findCandidates(q: FindQuery): HTMLElement[] {
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

export function normalizeTargets(input: Array<{ text?: string; role?: string }>): FindQuery[] {
  return input.map((t) => ({ text: t.text?.trim(), role: t.role?.trim() }));
}

