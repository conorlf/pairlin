export interface IossDetectionResult {
  status: 'ioss' | 'not_ioss' | 'unknown';
  confidence: number;
  signalsFound: string[];
}

const IOSS_SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /all taxes included/i, weight: 15, label: 'All taxes included language' },
  { pattern: /no additional charges on delivery/i, weight: 15, label: 'No additional charges language' },
  { pattern: /duties and taxes (paid|included)/i, weight: 15, label: 'Duties and taxes paid language' },
  { pattern: /import vat included/i, weight: 15, label: 'Import VAT included language' },
  { pattern: /EU[0-9]{9,15}/i, weight: 12, label: 'EU VAT registration number visible' },
  { pattern: /vat (number|reg|registration)/i, weight: 8, label: 'VAT registration mentioned' },
  { pattern: /vat\s*[\€\£]?\s*\d+\.\d{2}/i, weight: 10, label: 'VAT amount calculated at checkout' },
  { pattern: /including vat/i, weight: 10, label: 'Including VAT language' },
  { pattern: /tax\s*[\€\£]?\s*\d+\.\d{2}/i, weight: 8, label: 'Tax amount displayed' },
  { pattern: /prices include(d)? (vat|tax)/i, weight: 12, label: 'Prices include VAT statement' },
  { pattern: /customs cleared/i, weight: 12, label: 'Customs cleared language' },
  { pattern: /no customs surprises/i, weight: 10, label: 'No customs surprises language' },
];

const NOT_IOSS_SIGNALS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /customs charges may apply/i, weight: 18, label: 'Customs charges may apply warning' },
  { pattern: /import duties (are )?(the )?buyer'?s? responsibility/i, weight: 20, label: 'Import duties buyer responsibility' },
  { pattern: /recipient is responsible for (any )?customs/i, weight: 18, label: 'Recipient responsible for customs' },
  { pattern: /additional charges may apply (at|on) (delivery|import)/i, weight: 15, label: 'Additional charges may apply' },
  { pattern: /customs and duties not included/i, weight: 18, label: 'Customs not included language' },
  { pattern: /prices (shown |displayed )?(are |)?(excl|exclud)/i, weight: 10, label: 'Prices exclude tax language' },
  { pattern: /taxes? may apply/i, weight: 8, label: 'Taxes may apply language' },
  { pattern: /international (shipping|orders?).*customs/i, weight: 8, label: 'International shipping customs disclaimer' },
  { pattern: /you may be charged/i, weight: 10, label: 'You may be charged language' },
  { pattern: /local (taxes?|duties|customs)/i, weight: 8, label: 'Local taxes disclaimer' },
];

export function scorePageText(pageText: string): IossDetectionResult {
  let score = 0;
  const signalsFound: string[] = [];

  for (const signal of IOSS_SIGNALS) {
    if (signal.pattern.test(pageText)) {
      score += signal.weight;
      signalsFound.push(signal.label);
    }
  }

  for (const signal of NOT_IOSS_SIGNALS) {
    if (signal.pattern.test(pageText)) {
      score -= signal.weight;
      signalsFound.push(`[NOT IOSS] ${signal.label}`);
    }
  }

  const confidence = Math.min(100, Math.max(0, 50 + score * 1.5));

  let status: IossDetectionResult['status'];
  if (confidence >= 70) status = 'ioss';
  else if (confidence <= 30) status = 'not_ioss';
  else status = 'unknown';

  return { status, confidence: Math.round(confidence), signalsFound };
}
