const BACKEND_URL = 'http://localhost:3000';

const NON_EU_TLDS = ['.com', '.co.uk', '.net', '.io', '.us', '.ca', '.au'];
const EU_TLDS     = ['.ie', '.de', '.fr', '.nl', '.es', '.it', '.be', '.at', '.pl'];

function tldHeuristic(domain) {
  for (const tld of EU_TLDS)     if (domain.endsWith(tld)) return { status: 'ioss',     confidence: 45 };
  for (const tld of NON_EU_TLDS) if (domain.endsWith(tld)) return { status: 'not_ioss', confidence: 45 };
  return { status: 'unknown', confidence: 30 };
}

async function detectIOSS(domain) {
  // Step 1 — local cache via localStorage (24h TTL)
  const cacheKey = `pairlin_ioss_${domain}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts < 86400000) return entry.result;
    }
  } catch {}

  // Step 2 — shared database lookup
  try {
    const dbResp = await fetch(`${BACKEND_URL}/api/detect?domain=${encodeURIComponent(domain)}`);
    const dbResult = await dbResp.json();
    if (dbResult.found) {
      const result = { status: dbResult.status, confidence: dbResult.confidence, source: 'database' };
      localStorage.setItem(cacheKey, JSON.stringify({ result, ts: Date.now() }));
      return result;
    }
  } catch {}

  // Step 3 — TLD heuristic while API call runs
  const heuristic = tldHeuristic(domain);

  // Step 4 — full detection with page text + web search
  try {
    const pageText = document.body?.innerText ?? '';
    const resp = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageText: pageText.slice(0, 8000), domain }),
    });
    const result = await resp.json();
    if (!result.status) return { ...heuristic, source: 'tld_heuristic' };
    localStorage.setItem(cacheKey, JSON.stringify({ result, ts: Date.now() }));
    return result;
  } catch {
    return { ...heuristic, source: 'tld_heuristic' };
  }
}

window._pairlin_detectIOSS = detectIOSS;
