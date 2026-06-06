const BACKEND_URL = 'https://your-backend.up.railway.app'; // replaced at deploy

const IOSS_KEYWORDS = [
  'all taxes included', 'no additional charges on delivery',
  'duties and taxes paid', 'duties and taxes included',
  'import vat included', 'including vat', 'prices include vat',
  'vat included', 'customs cleared', 'no customs surprises',
  'tax inclusive', 'all duties paid',
];

const NOT_IOSS_KEYWORDS = [
  "customs charges may apply", "import duties are the buyer",
  "buyer's responsibility", "recipient is responsible for",
  "additional charges may apply", "customs and duties not included",
  "prices shown exclude", "prices exclude vat", "taxes may apply",
  "you may be charged", "local taxes", "international duties",
];

function clientSideScore(text) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of IOSS_KEYWORDS) if (lower.includes(kw)) score += 12;
  for (const kw of NOT_IOSS_KEYWORDS) if (lower.includes(kw)) score -= 14;
  const confidence = Math.min(100, Math.max(0, 50 + score));
  let status;
  if (confidence >= 68) status = 'ioss';
  else if (confidence <= 32) status = 'not_ioss';
  else status = 'unknown';
  return { status, confidence };
}

async function detectIOSS(domain) {
  // Check extension cache (24h TTL)
  const cacheKey = `ioss_${domain}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] && Date.now() - cached[cacheKey].ts < 86400000) {
    return cached[cacheKey].result;
  }

  const pageText = document.body?.innerText ?? '';
  const clientResult = clientSideScore(pageText);

  // If unambiguous from client side, skip network call
  if (clientResult.confidence >= 72 || clientResult.confidence <= 28) {
    const result = { ...clientResult, signalsFound: [], cached: false };
    await chrome.storage.local.set({ [cacheKey]: { result, ts: Date.now() } });
    return result;
  }

  // Ambiguous — call backend
  try {
    const resp = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageText: pageText.slice(0, 8000), domain }),
    });
    const result = await resp.json();
    await chrome.storage.local.set({ [cacheKey]: { result, ts: Date.now() } });
    return result;
  } catch {
    return clientResult;
  }
}

window._pairlin_detectIOSS = detectIOSS;
