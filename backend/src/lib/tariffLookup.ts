export interface TariffRate {
  hsCode: string;
  hsDescription: string;
  dutyRate: number;
  vatRate: number;
  confidence: number;
}

// Rules-based HS classification by keyword matching.
// Returns null if confidence is below threshold — caller should then use OpenAI.
const RULES: Array<{
  patterns: RegExp[];
  hsCode: string;
  hsDescription: string;
  dutyRate: number;
  confidence: number;
}> = [
  // Electronics (0% duty)
  {
    patterns: [/phone|smartphone|mobile|iphone|android/i],
    hsCode: '8517', hsDescription: 'Smartphones and mobile phones', dutyRate: 0, confidence: 92,
  },
  {
    patterns: [/earphone|earbud|headphone|airpod|headset/i],
    hsCode: '8518', hsDescription: 'Headphones and earphones', dutyRate: 0, confidence: 90,
  },
  {
    patterns: [/charging cable|usb cable|lightning cable|type.c cable|charger cable/i],
    hsCode: '8544', hsDescription: 'Insulated wire and cables', dutyRate: 0, confidence: 90,
  },
  {
    patterns: [/power bank|portable charger|battery pack/i],
    hsCode: '8504', hsDescription: 'Power banks and battery chargers', dutyRate: 0, confidence: 88,
  },
  {
    patterns: [/usb hub|usb adapter|usb dongle/i],
    hsCode: '8536', hsDescription: 'USB connectors and adapters', dutyRate: 0, confidence: 87,
  },
  {
    patterns: [/phone case|phone cover|mobile case/i],
    hsCode: '3926', hsDescription: 'Other articles of plastics (phone cases)', dutyRate: 0.065, confidence: 85,
  },
  {
    patterns: [/screen protector|tempered glass/i],
    hsCode: '3926', hsDescription: 'Other articles of plastics (screen protectors)', dutyRate: 0.065, confidence: 85,
  },
  {
    patterns: [/laptop|notebook computer|macbook/i],
    hsCode: '8471', hsDescription: 'Laptop computers', dutyRate: 0, confidence: 90,
  },
  {
    patterns: [/tablet|ipad/i],
    hsCode: '8471', hsDescription: 'Tablet computers', dutyRate: 0, confidence: 90,
  },
  {
    patterns: [/speaker|bluetooth speaker|portable speaker/i],
    hsCode: '8518', hsDescription: 'Loudspeakers', dutyRate: 0, confidence: 88,
  },
  {
    patterns: [/smart watch|smartwatch|fitness tracker|fitness band/i],
    hsCode: '9102', hsDescription: 'Smartwatches and fitness trackers', dutyRate: 0.045, confidence: 86,
  },
  {
    patterns: [/camera|webcam|action cam/i],
    hsCode: '8525', hsDescription: 'Cameras and webcams', dutyRate: 0, confidence: 88,
  },
  {
    patterns: [/memory card|sd card|microsd/i],
    hsCode: '8523', hsDescription: 'Memory cards and storage media', dutyRate: 0, confidence: 90,
  },

  // Clothing — knitted (12% duty)
  {
    patterns: [/t.shirt|tshirt|tee shirt|tank top|singlet/i],
    hsCode: '6109', hsDescription: 'T-shirts and singlets, knitted', dutyRate: 0.12, confidence: 92,
  },
  {
    patterns: [/hoodie|sweatshirt|sweater|jumper|pullover/i],
    hsCode: '6110', hsDescription: 'Jerseys, pullovers, sweatshirts, knitted', dutyRate: 0.12, confidence: 91,
  },
  {
    patterns: [/legging|yoga pant|gym tight/i],
    hsCode: '6104', hsDescription: "Women's trousers and leggings, knitted", dutyRate: 0.12, confidence: 89,
  },
  {
    patterns: [/knitted dress|jersey dress/i],
    hsCode: '6104', hsDescription: "Women's dresses, knitted", dutyRate: 0.12, confidence: 88,
  },
  {
    patterns: [/knitted top|knitted blouse/i],
    hsCode: '6106', hsDescription: "Women's blouses, knitted", dutyRate: 0.12, confidence: 86,
  },
  {
    patterns: [/underwear|boxer|brief|bra|bralette|thong|knicker/i],
    hsCode: '6108', hsDescription: 'Underwear, knitted', dutyRate: 0.12, confidence: 88,
  },
  {
    patterns: [/sock|ankle sock|crew sock/i],
    hsCode: '6115', hsDescription: 'Hosiery and socks, knitted', dutyRate: 0.12, confidence: 91,
  },
  {
    patterns: [/tracksuit|jogger|sweat pant|training pant/i],
    hsCode: '6112', hsDescription: 'Tracksuits and athletic wear, knitted', dutyRate: 0.12, confidence: 89,
  },
  {
    patterns: [/sports? (bra|top|wear)|gym (wear|top|vest)|athletic top/i],
    hsCode: '6112', hsDescription: 'Sports and athletic wear, knitted', dutyRate: 0.12, confidence: 88,
  },

  // Clothing — woven (12% duty)
  {
    patterns: [/jeans|denim (trousers|pants|shorts)/i],
    hsCode: '6203', hsDescription: "Men's trousers, denim, woven", dutyRate: 0.12, confidence: 90,
  },
  {
    patterns: [/woven dress|summer dress|floral dress|midi dress|maxi dress/i],
    hsCode: '6204', hsDescription: "Women's dresses, woven", dutyRate: 0.12, confidence: 89,
  },
  {
    patterns: [/blouse|woven top|chiffon top|satin top/i],
    hsCode: '6206', hsDescription: "Women's blouses and tops, woven", dutyRate: 0.12, confidence: 87,
  },
  {
    patterns: [/shorts|denim short|cargo short/i],
    hsCode: '6203', hsDescription: "Men's shorts, woven", dutyRate: 0.12, confidence: 86,
  },
  {
    patterns: [/jacket|coat|blazer|parka|windbreaker/i],
    hsCode: '6201', hsDescription: 'Outerwear and jackets, woven', dutyRate: 0.12, confidence: 87,
  },
  {
    patterns: [/swimwear|swimsuit|bikini|swim short|boardshort/i],
    hsCode: '6211', hsDescription: 'Swimwear and sportswear, woven', dutyRate: 0.12, confidence: 91,
  },
  {
    patterns: [/shirt|button.down|oxford shirt|polo shirt/i],
    hsCode: '6205', hsDescription: "Men's shirts, woven", dutyRate: 0.12, confidence: 88,
  },
  {
    patterns: [/scarf|wrap|shawl|pashmina/i],
    hsCode: '6214', hsDescription: 'Shawls and scarves', dutyRate: 0.12, confidence: 89,
  },

  // Footwear (17% duty)
  {
    patterns: [/trainer|sneaker|running shoe|athletic shoe|sports shoe/i],
    hsCode: '6402', hsDescription: 'Trainers and sports footwear', dutyRate: 0.17, confidence: 92,
  },
  {
    patterns: [/boot|ankle boot|chelsea boot/i],
    hsCode: '6403', hsDescription: 'Boots with leather soles', dutyRate: 0.17, confidence: 89,
  },
  {
    patterns: [/sandal|flip flop|slipper/i],
    hsCode: '6402', hsDescription: 'Sandals and flip flops', dutyRate: 0.17, confidence: 90,
  },
  {
    patterns: [/heel|stiletto|pump|court shoe/i],
    hsCode: '6403', hsDescription: "Women's heeled footwear", dutyRate: 0.17, confidence: 88,
  },
  {
    patterns: [/shoe|footwear|loafer|moccasin|flat shoe/i],
    hsCode: '6405', hsDescription: 'Other footwear', dutyRate: 0.17, confidence: 82,
  },

  // Bags (3.7% duty)
  {
    patterns: [/handbag|shoulder bag|tote bag|clutch/i],
    hsCode: '4202', hsDescription: 'Handbags and shoulder bags', dutyRate: 0.037, confidence: 90,
  },
  {
    patterns: [/backpack|rucksack|schoolbag/i],
    hsCode: '4202', hsDescription: 'Backpacks and rucksacks', dutyRate: 0.037, confidence: 91,
  },
  {
    patterns: [/wallet|purse|card holder|coin purse/i],
    hsCode: '4202', hsDescription: 'Wallets and purses', dutyRate: 0.037, confidence: 91,
  },

  // Cosmetics (6.5% duty)
  {
    patterns: [/lipstick|lip gloss|lip liner|lip (balm|product)/i],
    hsCode: '3304', hsDescription: 'Lip cosmetics', dutyRate: 0.065, confidence: 93,
  },
  {
    patterns: [/foundation|concealer|bb cream|tinted moisturiser/i],
    hsCode: '3304', hsDescription: 'Foundation and skin makeup', dutyRate: 0.065, confidence: 92,
  },
  {
    patterns: [/mascara|eyeliner|eyeshadow|eye (makeup|make.up)|eyebrow/i],
    hsCode: '3304', hsDescription: 'Eye makeup preparations', dutyRate: 0.065, confidence: 93,
  },
  {
    patterns: [/blush|bronzer|highlighter|contour/i],
    hsCode: '3304', hsDescription: 'Face makeup preparations', dutyRate: 0.065, confidence: 91,
  },
  {
    patterns: [/shampoo|conditioner|hair mask|hair treatment/i],
    hsCode: '3305', hsDescription: 'Hair care preparations', dutyRate: 0.065, confidence: 92,
  },
  {
    patterns: [/perfume|cologne|eau de toilette|fragrance/i],
    hsCode: '3303', hsDescription: 'Perfumes and toilet waters', dutyRate: 0, confidence: 92,
  },
  {
    patterns: [/moisturiser|moisturizer|face cream|serum|skincare|skin care/i],
    hsCode: '3304', hsDescription: 'Skin care preparations', dutyRate: 0.065, confidence: 90,
  },
  {
    patterns: [/nail (polish|varnish|lacquer)|nail (gel|art)/i],
    hsCode: '3304', hsDescription: 'Nail preparations', dutyRate: 0.065, confidence: 93,
  },
  {
    patterns: [/deodorant|antiperspirant/i],
    hsCode: '3307', hsDescription: 'Deodorants and antiperspirants', dutyRate: 0.065, confidence: 92,
  },

  // Hair accessories (2.7%)
  {
    patterns: [/hair (clip|grip|pin|slide|band|tie|scrunchie|accessory)/i],
    hsCode: '9615', hsDescription: 'Hair accessories and clips', dutyRate: 0.027, confidence: 90,
  },
  {
    patterns: [/headband|hair hoop/i],
    hsCode: '9615', hsDescription: 'Headbands', dutyRate: 0.027, confidence: 88,
  },

  // Jewellery (3.7% imitation, 2.5% precious)
  {
    patterns: [/necklace|bracelet|ring|earring|anklet|jewellery|jewelry/i],
    hsCode: '7117', hsDescription: 'Imitation jewellery', dutyRate: 0.037, confidence: 85,
  },

  // Toys/games (4.7%)
  {
    patterns: [/toy|action figure|doll|lego|board game|puzzle/i],
    hsCode: '9503', hsDescription: 'Toys and games', dutyRate: 0.047, confidence: 89,
  },

  // Books (0%)
  {
    patterns: [/book|novel|textbook|paperback|hardback/i],
    hsCode: '4901', hsDescription: 'Printed books', dutyRate: 0, confidence: 95,
  },
];

export function classifyByRules(title: string, description = '', category = ''): TariffRate | null {
  const text = `${title} ${description} ${category}`;

  for (const rule of RULES) {
    if (rule.patterns.some(p => p.test(text))) {
      return {
        hsCode: rule.hsCode,
        hsDescription: rule.hsDescription,
        dutyRate: rule.dutyRate,
        vatRate: 0.23,
        confidence: rule.confidence,
      };
    }
  }

  return null;
}

// Fallback duty rate by HS chapter
export function dutyRateByHsCode(hsCode: string): number {
  const chapter = parseInt(hsCode.slice(0, 2), 10);
  if (chapter === 85 || chapter === 84) return 0;
  if (chapter === 49) return 0;
  if (chapter === 61 || chapter === 62 || chapter === 63) return 0.12;
  if (chapter === 64) return 0.17;
  if (chapter === 33) return 0.065;
  if (chapter === 42) return 0.037;
  if (chapter === 71) return 0.037;
  if (chapter === 91) return 0.045;
  if (chapter === 95) return 0.047;
  if (chapter === 39) return 0.065;
  if (chapter === 96) return 0.027;
  return 0.035; // conservative default
}
