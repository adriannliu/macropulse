import type { FoodItem } from './mathEngine';

export const DEFAULT_FOODS: FoodItem[] = [
  { id: 'chicken', name: 'Chicken Breast (Cooked)', category: 'Protein', p: 31.0, c: 0.0, f: 3.6, defaultGrams: 150 },
  { id: 'braised_beef', name: 'Braised / Stewed Beef (Hong Shao Niu Rou)', category: 'Home-Cooked', p: 26.5, c: 4.2, f: 11.8, defaultGrams: 180 },
  { id: 'millet_porridge', name: 'Millet Porridge (Xiao Mi Zhou)', category: 'Home-Cooked', p: 2.8, c: 18.5, f: 0.9, defaultGrams: 250 },
  { id: 'white_rice', name: 'Steamed Jasmine Rice', category: 'Carbs', p: 2.7, c: 28.2, f: 0.3, defaultGrams: 200 },
  { id: 'tofu', name: 'Pan-Seared Firm Tofu', category: 'Home-Cooked', p: 15.8, c: 2.9, f: 8.7, defaultGrams: 150 },
  { id: 'tomato_egg', name: 'Tomato & Egg Stir-Fry', category: 'Home-Cooked', p: 7.4, c: 5.1, f: 8.2, defaultGrams: 200 },
  { id: 'eggs', name: 'Whole Large Eggs', category: 'Protein', p: 12.6, c: 0.7, f: 9.5, defaultGrams: 100 },
  { id: 'whey', name: 'Whey Protein Isolate', category: 'Protein', p: 83.0, c: 3.0, f: 1.5, defaultGrams: 30 },
  { id: 'oats', name: 'Rolled Oats (Dry)', category: 'Carbs', p: 13.2, c: 67.7, f: 6.5, defaultGrams: 80 },
  { id: 'avocado', name: 'Hass Avocado', category: 'Fats', p: 2.0, c: 8.5, f: 14.7, defaultGrams: 100 },
  { id: 'olive_oil', name: 'Extra Virgin Olive Oil', category: 'Fats', p: 0.0, c: 0.0, f: 100.0, defaultGrams: 15 },
];
