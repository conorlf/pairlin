const BACKEND_URL = 'https://your-backend.up.railway.app'; // replaced at deploy

// TLD heuristic — used only when domain not in DB and before page text is available.
// Non-EU TLDs suggest the retailer is likely outside IOSS scope.
const NON_EU_TLDS = ['.com', '.co.uk', '.net', '.io', '.us', '.ca', '.au'];
const EU_TLDS     = ['.ie', '.de', '.fr', '.nl', '.es', '.it', '.be', '.at', '.pl'];

function tldHeuristic(domain) {
  for (const tld of EU_TLDS)     if (domain.endsWith(tld)) return { status: 'ioss',     confidence: 45 };
  for (const tld of NON_EU_TLDS) if (domain.endsWith(tld)) return { status: 'not_ioss', confidence: 45 };
  return { status: 'unknown', confidence: 30 };
}

async function detectIOSS(domain) {
  // Step 1 — extension-local cache (avoids any network call for repeat visits)
  const cacheKey = `ioss_${domain}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey] && Date.now() - cached[cacheKey].ts < 86400000) {
    return cached[cacheKey].result;
  }

  // Step 2 — shared database lookup
  // If any previous user already classified this domain, return instantly
  try {
    const dbResp = await fetch(`${BACKEND_URL}/api/detect?domain=${encodeURIComponent(domain)}`);
    const dbResult = await dbResp.json();
    if (dbResult.found) {
      const result = { status: dbResult.status, confidence: dbResult.confidence, source: 'database' };
      await chrome.storage.local.set({ [cacheKey]: { result, ts: Date.now() } });
      return result;
    }
  } catch { /* backend unreachable — fall through */ }

  // Step 3 — URL/TLD heuristic (instant, no network)
  // Gives a low-confidence initial signal while the API call is in flight
  const heuristic = tldHeuristic(domain);

  // Step 4 — full detection API with page text
  // Returns confidence score, stores result in DB for all future users
  try {
    const pageText = document.body?.innerText ?? '';
    const resp = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageText: pageText.slice(0, 8000), domain }),
    });
    const result = await resp.json();
    await chrome.storage.local.set({ [cacheKey]: { result, ts: Date.now() } });
    return result;
  } catch {
    // API unreachable — return TLD heuristic as fallback with low confidence
    return { ...heuristic, source: 'tld_heuristic' };
  }
}

window._landedcost_detectIOSS = detectIOSS;