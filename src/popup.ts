const keyEl = document.getElementById('key') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

saveBtn.addEventListener('click', () => {
  const v = (keyEl.value || '').trim();
  if (!v) return;
chrome.runtime.sendMessage({ kind: 'SET_API_KEY', key: v }, (ok: any) => {
    statusEl.textContent = ok ? 'Key set for this session' : 'Failed';
  });
});
