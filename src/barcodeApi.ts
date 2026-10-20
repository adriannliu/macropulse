import { calcKcal } from './mathEngine';
import type { NutritionSearchResult } from './nutritionApi';

const OFF_FIELDS = 'code,product_name,brands,categories,nutriments,serving_quantity';

/**
 * Normalizes scanned/typed barcodes to digits only. Returns null for anything
 * that isn't a plausible EAN-8, UPC-A, or EAN-13 / GTIN-14 code.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

async function fetchOpenFoodFactsProduct(code: string): Promise<any | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`;
  const res = await fetch(url);
  // OFF returns 404 with status 0 for unknown products
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Open Food Facts error (${res.status})`);
  }
  const data = await res.json();
  return data.status === 1 && data.product ? data.product : null;
}

/**
 * Looks up a packaged food by barcode in Open Food Facts (world.openfoodfacts.org).
 * Returns macros per 100g, or null when the product is unknown or lacks nutrition data.
 */
export async function lookupBarcode(rawCode: string): Promise<NutritionSearchResult | null> {
  const code = normalizeBarcode(rawCode);
  if (!code) {
    throw new Error('Invalid barcode. Expected 8 to 14 digits.');
  }

  let product = await fetchOpenFoodFactsProduct(code);
  // US UPC-A codes (12 digits) are often stored as EAN-13 with a leading zero
  if (!product && code.length === 12) {
    product = await fetchOpenFoodFactsProduct(`0${code}`);
  }
  if (!product) return null;

  const n = product.nutriments || {};
  const hasMacros = ['proteins_100g', 'carbohydrates_100g', 'fat_100g'].some(
    (k) => n[k] !== undefined && n[k] !== ''
  );
  if (!hasMacros) return null;

  const p = Math.max(0, Number(n.proteins_100g) || 0);
  const c = Math.max(0, Number(n.carbohydrates_100g) || 0);
  const f = Math.max(0, Number(n.fat_100g) || 0);
  const labelKcal = Number(n['energy-kcal_100g']);

  const brand = (product.brands || '').split(',')[0].trim() || undefined;
  const baseName = (product.product_name || '').trim() || `Barcode ${code}`;
  const name = brand && !baseName.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} ${baseName}`
    : baseName;

  const serving = Math.round(Number(product.serving_quantity) || 0);

  return {
    id: `off_${code}`,
    name,
    brand,
    category: 'Packaged',
    p: Math.round(p * 10) / 10,
    c: Math.round(c * 10) / 10,
    f: Math.round(f * 10) / 10,
    kcal: labelKcal > 0 ? Math.round(labelKcal) : Math.round(calcKcal(p, c, f)),
    defaultGrams: serving > 0 && serving <= 1000 ? serving : 100,
    source: 'openfoodfacts',
  };
}
