import axios from 'axios';

export interface CourierHandlingResult {
  amount: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'documentation' | 'calculator' | 'national_postal_fallback';
  courierName: string;
}

const ANPOST_FLAT = 6.00;
const IOSS_PER_HEADING = 3.00; // July 2026 reform

export async function getCourierHandling(
  courier: string | null,
  basketValueEur: number,
  distinctHsChapters: number,
  isIoss: boolean,
  isOver150: boolean
): Promise<CourierHandlingResult> {
  if (isIoss && !isOver150) {
    return {
      amount: distinctHsChapters * IOSS_PER_HEADING,
      confidence: 'high',
      source: 'documentation',
      courierName: courier ?? 'An Post',
    };
  }

  const c = (courier ?? '').toLowerCase();

  if (c.includes('dhl')) {
    // DHL: 2.5% of duties+taxes, min €12.50
    const duties = basketValueEur * 0.12;
    const vat = (basketValueEur + duties) * 0.23;
    const fee = Math.max(12.50, (duties + vat) * 0.025);
    return { amount: Math.round(fee * 100) / 100, confidence: 'high', source: 'documentation', courierName: 'DHL' };
  }

  if (c.includes('fedex')) {
    return { amount: 15.00, confidence: 'high', source: 'documentation', courierName: 'FedEx' };
  }

  if (c.includes('anpost') || c.includes('an post') || !courier) {
    return {
      amount: ANPOST_FLAT,
      confidence: 'high',
      source: 'documentation',
      courierName: 'An Post',
    };
  }

  // Unknown courier — use An Post as fallback with 15% buffer
  return {
    amount: Math.round(ANPOST_FLAT * 1.15 * 100) / 100,
    confidence: 'low',
    source: 'national_postal_fallback',
    courierName: courier,
  };
}

// ECB daily EUR FX rates
let fxCache: { rates: Record<string, number>; ts: number } | null = null;

export async function toEur(amount: number, currency: string): Promise<number> {
  if (currency.toUpperCase() === 'EUR') return amount;

  try {
    if (!fxCache || Date.now() - fxCache.ts > 4 * 60 * 60 * 1000) {
      const url = 'https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A?lastNObservations=1&format=jsondata';
      const { data } = await axios.get(url, { timeout: 5000 });
      const series = data?.dataSets?.[0]?.series;
      const rates: Record<string, number> = {};
      if (series) {
        const keys = Object.keys(series);
        for (const key of keys) {
          const parts = key.split(':');
          const curr = parts[1];
          const obs = series[key]?.observations;
          if (curr && obs) {
            const vals = Object.values(obs) as number[][];
            if (vals.length > 0) rates[curr] = vals[vals.length - 1][0];
          }
        }
      }
      fxCache = { rates, ts: Date.now() };
    }

    const rate = fxCache.rates[currency.toUpperCase()];
    if (!rate) return amount; // fallback: assume EUR
    return amount / rate;
  } catch {
    return amount; // fallback on network error
  }
}
