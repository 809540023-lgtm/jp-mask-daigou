// 預估重量模型：資料庫只有入數（枚數）與分類，沒有實秤重量，
// 因此以「分類基準值 + 每片重量 x 片數」推算每一包的預估重量（公克）。
// 使用者可直接改這裡的係數，或改 data/商品重量表.xlsx 內的係數後重新產生。

export const CATEGORY_BASE_G = {
  面膜: 20,
  眼膜: 18,
  精華: 150,
  化妝水: 260,
  乳液: 230,
  洗面乳: 150,
  其他: 200,
};

export const PER_SHEET_G = {
  面膜: 22,
  眼膜: 8,
};

export const FALLBACK_G = 200;
export const MIN_G = 30;

const SHEET_PATTERNS = [
  /(\d+)\s*枚/,
  /(\d+)\s*シート/,
  /(\d+)\s*枚入/,
  /(\d+)\s*袋/,
  /(\d+)\s*回分/,
  /(\d+)\s*本/,
  /(\d+)\s*個/,
  /(\d+)\s*錠/,
  /(\d+)\s*粒/,
  /(\d+)\s*包/,
];

export function detectSheetCount(row) {
  const direct = Number.parseInt(row['入數(數字)'] || '', 10);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const haystacks = [
    row['入數標示'],
    row['日文品名'],
    row['中文品名'],
    row['規格／款式'],
    row['備註'],
  ].filter(Boolean);

  for (const text of haystacks) {
    for (const pattern of SHEET_PATTERNS) {
      const m = String(text).match(pattern);
      if (m) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0 && n <= 500) return n;
      }
    }
  }
  return null;
}

export function estimateWeightG(row, sheetCount) {
  const category = row['分類'] || '其他';
  const base = CATEGORY_BASE_G[category] ?? FALLBACK_G;
  const perSheet = PER_SHEET_G[category];

  let grams;
  if (perSheet && sheetCount) {
    grams = base + perSheet * sheetCount;
  } else if (category === '其他' && sheetCount && sheetCount >= 10) {
    // 少數被歸在「其他」的大容量面膜盒
    grams = CATEGORY_BASE_G['面膜'] + PER_SHEET_G['面膜'] * sheetCount;
  } else {
    grams = base;
  }

  const rounded = Math.max(MIN_G, Math.round(grams / 5) * 5);
  return rounded;
}
