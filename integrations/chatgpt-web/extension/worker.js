const nativeHost = "io.github.tahap0l.nobetci.chatgpt";
const queues = new Map();

function enqueue(tabId, task) {
  const next = (queues.get(tabId) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(tabId, next);
  const cleanup = () => { if (queues.get(tabId) === next) queues.delete(tabId); };
  void next.then(cleanup, cleanup);
  return next;
}

async function publish(id, status) {
  try {
    return Boolean((await chrome.runtime.sendNativeMessage(nativeHost, { id, status }))?.ok);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId !== 0 || sender.origin !== "https://chatgpt.com") return;
  const { id, status } = message ?? {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) || !["working", "finished"].includes(status)) return;
  const key = `chatgpt-tab-${tabId}`;
  void enqueue(tabId, async () => {
    const previous = (await chrome.storage.session.get(key))[key];
    if (previous && previous !== id) await publish(previous, "closed");
    await chrome.storage.session.set({ [key]: id });
    return { ok: await publish(id, status) };
  }).then(reply, () => reply({ ok: false }));
  return true;
});

function close(tabId) {
  const key = `chatgpt-tab-${tabId}`;
  void enqueue(tabId, async () => {
    const id = (await chrome.storage.session.get(key))[key];
    if (!id) return;
    await chrome.storage.session.remove(key);
    await publish(id, "closed");
  }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(close);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") close(tabId);
});
