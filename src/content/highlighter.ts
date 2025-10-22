export function highlightElements(els: HTMLElement[], label = "Target") {
  cleanupHighlights();
  els.forEach((el, idx) => {
    const r = el.getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.className = "aws-assist-highlight";
    Object.assign(overlay.style as any, {
      position: "fixed",
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
    Object.assign(tag.style as any, {
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

export function cleanupHighlights() {
  document.querySelectorAll(".aws-assist-highlight").forEach((n) => n.remove());
}
