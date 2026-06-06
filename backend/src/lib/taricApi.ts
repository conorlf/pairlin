import axios from 'axios';

export interface TaricLiveResult {
  hsCode: string;
  dutyRate: number | null;
  dutyExpression: string | null;
  description: string | null;
  confidence: 'live' | 'fallback';
  source: 'uk_trade_tariff' | 'local_table';
}

// UK Trade Tariff API — public, no auth, returns EU-equivalent rates for all
// major consumer goods categories (clothing 12%, footwear 17%, electronics 0%).
// Acts as live proxy for EU TARIC until EU Commission opens their API server-side.
// Docs: https://api.trade-tariff.service.gov.uk/the-commodities-api.html
const UK_TARIFF_BASE = 'https://api.trade-tariff.service.gov.uk/api/v2';

// EU-specific overrides where UK rate diverged post-Brexit.
// For these HS chapters, prefer our local table over the UK API.
const EU_OVERRIDES: Record<string, number> = {
  '22': 0.0,   // Beverages — EU zero for water, UK charges some
  '87': 0.065, // Vehicles — EU/UK differ on some EV categories
};

// 24-hour in-memory cache — keyed by 4-digit HS code
const rateCache = new Map<string, { result: TaricLiveResult; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function getLiveDutyRate(
  hsCode: string,
  originCountry = 'CN'
): Promise<TaricLiveResult> {
  const chapter = hsCode.slice(0, 2);
  const cacheKey = `${hsCode}_${originCountry}`;

  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.result;
  }

  // Check if we have an EU-specific override for this chapter
  if (EU_OVERRIDES[chapter] !== undefined) {
    const result: TaricLiveResult = {
      hsCode,
      dutyRate: EU_OVERRIDES[chapter],
      dutyExpression: `${(EU_OVERRIDES[chapter] * 100).toFixed(1)}%`,
      description: null,
      confidence: 'live',
      source: 'local_table',
    };
    rateCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }

  // Pad HS code to 10 digits for the commodity lookup
  const commodityCode = hsCode.padEnd(10, '0');

  try {
    const { data } = await axios.get(
      `${UK_TARIFF_BASE}/commodities/${commodityCode}`,
      {
        timeout: 8000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LandedCost/1.0 (customs duty calculator; contact@landedcost.io)',
        },
      }
    );

    // The API returns included[] with measure types.
    // Type 'third_country_duty' (measure_type id 103) is the MFN rate — what
    // applies to imports from China/UK/US unless a trade agreement applies.
    const included: unknown[] = data?.included ?? [];

    interface Measure {
      type: string;
      attributes?: { measure_type_id?: string; duty_expression?: { base?: string; formatted_base?: string } };
    }

    const mfnMeasure = (included as Measure[]).find(item =>
      item.type === 'measure' &&
      (item.attributes?.measure_type_id === '103' || item.attributes?.measure_type_id === '105')
    );

    const dutyStr: string | null =
      mfnMeasure?.attributes?.duty_expression?.formatted_base ??
      mfnMeasure?.attributes?.duty_expression?.base ??
      null;

    let dutyRate: number | null = null;
    if (dutyStr) {
      const match = dutyStr.match(/([\d.]+)\s*%/);
      if (match) dutyRate = parseFloat(match[1]) / 100;
    }

    // Fall back to zero if commodity has no third-country duty (e.g. electronics)
    if (dutyRate === null && dutyStr === null) dutyRate = 0;

    const description: string | null =
      data?.data?.attributes?.description ?? null;

    const result: TaricLiveResult = {
      hsCode,
      dutyRate,
      dutyExpression: dutyStr,
      description,
      confidence: 'live',
      source: 'uk_trade_tariff',
    };

    rateCache.set(cacheKey, { result, ts: Date.now() });
    return result;

  } catch (err) {
    console.warn(`[taricApi] Live lookup failed for ${hsCode}:`, (err as Error).message);

    // Fallback to local table
    const fallbackRate = localFallbackRate(hsCode);
    const result: TaricLiveResult = {
      hsCode,
      dutyRate: fallbackRate,
      dutyExpression: `${(fallbackRate * 100).toFixed(1)}% (estimated)`,
      description: null,
      confidence: 'fallback',
      source: 'local_table',
    };
    rateCache.set(cacheKey, { result, ts: Date.now() });
    return result;
  }
}

// Local fallback table based on EU CN 2026 (eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202501926)
function localFallbackRate(hsCode: string): number {
  const chapter = parseInt(hsCode.slice(0, 2), 10);
  if (chapter === 61 || chapter === 62 || chapter === 63) return 0.12; // Clothing
  if (chapter === 64) return 0.17; // Footwear
  if (chapter === 85 || chapter === 84) return 0;  // Electronics/machinery
  if (chapter === 49) return 0;    // Books
  if (chapter === 33) return 0.065; // Cosmetics
  if (chapter === 42) return 0.037; // Leather goods/bags
  if (chapter === 71) return 0.037; // Jewellery
  if (chapter === 91) return 0.045; // Watches
  if (chapter === 95) return 0.047; // Toys
  if (chapter === 96) return 0.027; // Misc (hair accessories)
  if (chapter === 39) return 0.065; // Plastics
  if (chapter === 87) return 0.065; // Vehicles/bicycles (varies)
  if (chapter === 90) return 0.029; // Optical/instruments
  return 0.035; // conservative default for unclassified
}
