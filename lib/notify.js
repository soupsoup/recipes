// Posts a message to a Mattermost (or Slack-compatible) incoming webhook.
// Without a webhook URL it only logs, so local runs and tests need no setup.
function webhookNotifier(url) {
  return async (text) => {
    if (!url) {
      console.log(`[notify] ${text}`);
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.error(`[notify] webhook answered ${res.status}`);
    } catch (err) {
      console.error(`[notify] webhook failed: ${err.message}`);
    }
  };
}

// Member-typed text goes into a chat message, so keep it from turning into links or formatting.
function plain(value) {
  return String(value || '').replace(/[`*_~[\]()<>|#!\\]/g, '').slice(0, 80);
}

module.exports = { webhookNotifier, plain };
