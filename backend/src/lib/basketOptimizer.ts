export interface ClassifiedItem {
  title: string;
  hsCode: string;
  hsDescription: string;
  price_eur: number;
  qty: number;
  dutyRate: number;
  vatRate: number;
  confidence: number;
}

export interface ScenarioResult {
  basketTotal: number;
  duty: number;
  vat: number;
  courierHandling: number;
  serviceFee: number;
  total: number;
  distinctHsChapters: number;
}

export interface OptimisationResult {
  recommended: 'keep' | 'split' | 'warn_threshold' | 'consolidate';
  saving: number;
  splits?: [ClassifiedItem[], ClassifiedItem[]];
  explanation: string;
  suggestedCategories?: string[];
  baseScenario: ScenarioResult;
  optimisedScenario?: ScenarioResult;
}

const SERVICE_FEE_NON_IOSS = 2.95;
const SERVICE_FEE_OVER_150 = 3.05;
const SERVICE_FEE_PROTECTION = 1.99;
const IOSS_DUTY_PER_HEADING = 3.00;
const THRESHOLD_WARNING_ZONE = 130;
const CUSTOMS_THRESHOLD = 150;
const MIN_SAVING_TO_RECOMMEND = 1.00;

function distinctChapters(items: ClassifiedItem[]): number {
  return new Set(items.map(i => i.hsCode.slice(0, 2))).size;
}

function calcScenario(
  items: ClassifiedItem[],
  iossStatus: string,
  handlingPerDeclaration: number,
  serviceFee: number
): ScenarioResult {
  const basketTotal = items.reduce((s, i) => s + i.price_eur * i.qty, 0);
  const chapters = distinctChapters(items);
  const isOver150 = basketTotal >= CUSTOMS_THRESHOLD;
  const isIoss = iossStatus === 'ioss';

  let duty = 0;
  if (isIoss && !isOver150) {
    duty = chapters * IOSS_DUTY_PER_HEADING;
  } else {
    duty = items.reduce((s, i) => s + i.price_eur * i.qty * i.dutyRate, 0);
  }

  const vat = items.reduce((s, i) => {
    const itemTotal = i.price_eur * i.qty;
    const itemDuty = (isIoss && !isOver150) ? 0 : itemTotal * i.dutyRate;
    return s + (itemTotal + itemDuty) * i.vatRate;
  }, 0);

  const courierHandling = handlingPerDeclaration;
  const total = basketTotal + duty + vat + courierHandling + serviceFee;

  return { basketTotal, duty, vat, courierHandling, serviceFee, total, distinctHsChapters: chapters };
}

function calcSplitScenario(
  splitA: ClassifiedItem[],
  splitB: ClassifiedItem[],
  iossStatus: string,
  handlingPerDeclaration: number
): ScenarioResult {
  const sA = calcScenario(splitA, iossStatus, handlingPerDeclaration, SERVICE_FEE_NON_IOSS);
  const sB = calcScenario(splitB, iossStatus, handlingPerDeclaration, SERVICE_FEE_NON_IOSS);
  return {
    basketTotal: sA.basketTotal + sB.basketTotal,
    duty: sA.duty + sB.duty,
    vat: sA.vat + sB.vat,
    courierHandling: sA.courierHandling + sB.courierHandling,
    serviceFee: sA.serviceFee + sB.serviceFee,
    total: sA.total + sB.total,
    distinctHsChapters: sA.distinctHsChapters + sB.distinctHsChapters,
  };
}

// Try to build two splits both under €150, grouping by HS chapter value
function buildNaturalSplit(items: ClassifiedItem[]): [ClassifiedItem[], ClassifiedItem[]] | null {
  // Group items by HS chapter, sort by total value descending
  const byChapter = new Map<string, ClassifiedItem[]>();
  for (const item of items) {
    const ch = item.hsCode.slice(0, 2);
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(item);
  }

  const chapters = [...byChapter.entries()].sort((a, b) => {
    const valA = a[1].reduce((s, i) => s + i.price_eur * i.qty, 0);
    const valB = b[1].reduce((s, i) => s + i.price_eur * i.qty, 0);
    return valB - valA;
  });

  const splitA: ClassifiedItem[] = [];
  const splitB: ClassifiedItem[] = [];
  let totalA = 0;

  for (const [, chItems] of chapters) {
    const chTotal = chItems.reduce((s, i) => s + i.price_eur * i.qty, 0);
    if (totalA + chTotal <= CUSTOMS_THRESHOLD) {
      splitA.push(...chItems);
      totalA += chTotal;
    } else {
      splitB.push(...chItems);
    }
  }

  if (splitA.length === 0 || splitB.length === 0) return null;
  const totalB = splitB.reduce((s, i) => s + i.price_eur * i.qty, 0);
  if (totalB > CUSTOMS_THRESHOLD && totalA > CUSTOMS_THRESHOLD) return null;

  return [splitA, splitB];
}

export function optimise(
  items: ClassifiedItem[],
  iossStatus: string,
  handlingPerDeclaration: number
): OptimisationResult {
  if (items.length === 0) {
    const empty: ScenarioResult = { basketTotal: 0, duty: 0, vat: 0, courierHandling: 0, serviceFee: 0, total: 0, distinctHsChapters: 0 };
    return { recommended: 'keep', saving: 0, explanation: 'No items in basket.', baseScenario: empty };
  }

  const basketTotal = items.reduce((s, i) => s + i.price_eur * i.qty, 0);
  const isOver150 = basketTotal >= CUSTOMS_THRESHOLD;
  const isIoss = iossStatus === 'ioss';
  const serviceFee = isOver150 ? SERVICE_FEE_OVER_150 : SERVICE_FEE_NON_IOSS;
  const base = calcScenario(items, iossStatus, handlingPerDeclaration, serviceFee);
  const allDutyRates = items.map(i => i.dutyRate);
  const avgDutyRate = allDutyRates.reduce((s, r) => s + r, 0) / allDutyRates.length;
  const isLowDuty = allDutyRates.every(r => r <= 0.03);

  // Scenario C — approaching threshold warning
  if (!isOver150 && basketTotal >= THRESHOLD_WARNING_ZONE) {
    const gap = CUSTOMS_THRESHOLD - basketTotal;
    const overScenario = calcScenario(
      items.map(i => ({ ...i })),
      'not_ioss',
      handlingPerDeclaration,
      SERVICE_FEE_OVER_150
    );
    const additionalCost = overScenario.total - base.total;
    if (additionalCost > 15) {
      return {
        recommended: 'warn_threshold',
        saving: 0,
        explanation: `Your basket is €${basketTotal.toFixed(2)} — €${gap.toFixed(2)} away from the €150 threshold where IOSS no longer applies. Adding more items could cost an extra €${additionalCost.toFixed(2)} in customs charges at the border.`,
        baseScenario: base,
      };
    }
  }

  // Scenario B — low duty, consolidation recommended
  if (isOver150 && isLowDuty) {
    const chapters = distinctChapters(items);
    const splitResult = buildNaturalSplit(items);
    const splitCost = splitResult ? calcSplitScenario(splitResult[0], splitResult[1], iossStatus, handlingPerDeclaration).total : base.total + 20;
    const savingByKeeping = splitCost - base.total;
    const suggestedCategories = [...new Set(items.map(i => i.hsCode.slice(0, 2)))].map(ch => {
      const sample = items.find(i => i.hsCode.startsWith(ch));
      return sample?.hsDescription.split(',')[0] ?? ch;
    });
    return {
      recommended: 'consolidate',
      saving: Math.max(0, savingByKeeping),
      explanation: `Your basket has ${chapters} tariff heading${chapters > 1 ? 's' : ''} at 0–3% duty. Splitting would add duplicate €3 handling charges and cost more. Keep as one order. Adding more items from the same categories costs no extra customs duty.`,
      suggestedCategories,
      baseScenario: base,
    };
  }

  // Scenario A — high duty, check if split saves money
  if (isOver150 && avgDutyRate > 0.03) {
    const splitResult = buildNaturalSplit(items);
    if (splitResult) {
      const splitScenario = calcSplitScenario(splitResult[0], splitResult[1], iossStatus, handlingPerDeclaration);
      const saving = base.total - splitScenario.total;
      if (saving > MIN_SAVING_TO_RECOMMEND) {
        const tA = splitResult[0].reduce((s, i) => s + i.price_eur * i.qty, 0);
        const tB = splitResult[1].reduce((s, i) => s + i.price_eur * i.qty, 0);
        return {
          recommended: 'split',
          saving: Math.round(saving * 100) / 100,
          splits: splitResult,
          explanation: `Split into 2 orders (€${tA.toFixed(2)} + €${tB.toFixed(2)}) — each stays under €150, avoiding €${(base.duty).toFixed(2)} in border customs duty. One extra €3 handling fee applies.`,
          baseScenario: base,
          optimisedScenario: splitScenario,
        };
      }
    }
  }

  return {
    recommended: 'keep',
    saving: 0,
    explanation: 'Your basket is already optimised. No splitting or changes needed.',
    baseScenario: base,
  };
}
