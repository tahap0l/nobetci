// Only observe the availability of ChatGPT's stop-generation control.
const id = crypto.randomUUID();
let lastSent;
let inFlight = false;
let timer;

async function updateStatus() {
  const generating = Boolean(document.querySelector('button[data-testid="stop-button"]'));
  if (inFlight || (lastSent === undefined && !generating) || lastSent === generating) return;
  inFlight = true;
  try {
    const reply = await chrome.runtime.sendMessage({ id, status: generating ? "working" : "finished" });
    if (reply?.ok) lastSent = generating;
  } catch {
    // The extension or native host may have been reloaded.
  } finally {
    inFlight = false;
  }
}

new MutationObserver(() => {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void updateStatus();
  }, 120);
}).observe(document.documentElement, {
  subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid"],
});
setInterval(updateStatus, 5000);
void updateStatus();
