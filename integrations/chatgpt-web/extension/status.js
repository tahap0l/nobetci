// Only observe the availability of ChatGPT's stop-generation control.
const id = crypto.randomUUID();
// Every try makes the browser start Nobi's native host, a new process. After
// a failed one (Nobi closed, the host not registered) wait before the next:
// 5 s, then twice as long each time, up to a minute.
const FIRST_RETRY_MS = 5_000;
const LAST_RETRY_MS = 60_000;
let lastSent;
let inFlight = false;
let timer;
let retryDelay = 0;
let retryAt = 0;

function failed() {
  retryDelay = retryDelay ? Math.min(retryDelay * 2, LAST_RETRY_MS) : FIRST_RETRY_MS;
  retryAt = Date.now() + retryDelay;
}

async function updateStatus() {
  if (!chrome.runtime?.id) {
    // The extension was reloaded or removed: this copy of the script is orphaned.
    stop();
    return;
  }
  const generating = Boolean(document.querySelector('button[data-testid="stop-button"]'));
  if (inFlight || (lastSent === undefined && !generating) || lastSent === generating) return;
  if (Date.now() < retryAt) return;
  inFlight = true;
  try {
    const reply = await chrome.runtime.sendMessage({ id, status: generating ? "working" : "finished" });
    if (reply?.ok) {
      lastSent = generating;
      retryDelay = 0;
      retryAt = 0;
    } else {
      failed();
    }
  } catch {
    // The extension or native host may have been reloaded.
    failed();
  } finally {
    inFlight = false;
  }
}

const observer = new MutationObserver(() => {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void updateStatus();
  }, 120);
});
observer.observe(document.documentElement, {
  subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid"],
});
// Picks up a retry that is due, and a state change the observer missed.
const interval = setInterval(updateStatus, 5000);

function stop() {
  observer.disconnect();
  clearInterval(interval);
  clearTimeout(timer);
}

void updateStatus();
