export interface MacroVector {
  p: number; // Protein (g per 100g)
  c: number; // Carbs (g per 100g)
  f: number; // Fat (g per 100g)
}

export interface FoodItem extends MacroVector {
  id: string;
  name: string;
  category: string;
  defaultGrams: number;
}

export interface LoggedFood {
  uid: string;
  food: FoodItem;
  grams: number;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
}

// 4-4-9 Atwater exact calorie formula
export const calcKcal = (p: number, c: number, f: number): number => {
  return 4 * p + 4 * c + 9 * f;
};

// Mifflin-St Jeor BMR & TDEE
export const calcMifflinStJeor = (
  sex: 'male' | 'female',
  weightKg: number,
  heightCm: number,
  age: number,
  activityMultiplier: number
) => {
  const s = sex === 'male' ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + s;
  const tdee = bmr * activityMultiplier;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee) };
};

// 3x3 Determinant helper
const det3x3 = (m: number[][]): number => {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
};

/**
 * Solves A * x = b where:
 *   Columns of A are per-gram macro densities of 3 anchor foods [Food1, Food2, Food3]
 *   b is the remaining macro deficit [remP, remC, remF]
 * Returns exact gram weights [g1, g2, g3] via Cramer's Rule
 */
export const solveMacroDeficit3x3 = (
  f1: FoodItem,
  f2: FoodItem,
  f3: FoodItem,
  remP: number,
  remC: number,
  remF: number
): { g1: number; g2: number; g3: number; detA: number } | null => {
  const A = [
    [f1.p / 100, f2.p / 100, f3.p / 100],
    [f1.c / 100, f2.c / 100, f3.c / 100],
    [f1.f / 100, f2.f / 100, f3.f / 100],
  ];

  const D = det3x3(A);
  if (Math.abs(D) < 1e-7) return null;

  const A1 = [
    [remP, A[0][1], A[0][2]],
    [remC, A[1][1], A[1][2]],
    [remF, A[2][1], A[2][2]],
  ];
  const A2 = [
    [A[0][0], remP, A[0][2]],
    [A[1][0], remC, A[1][2]],
    [A[2][0], remF, A[2][2]],
  ];
  const A3 = [
    [A[0][0], A[0][1], remP],
    [A[1][0], A[1][1], remC],
    [A[2][0], A[2][1], remF],
  ];

  const g1 = Math.max(0, Math.round(det3x3(A1) / D));
  const g2 = Math.max(0, Math.round(det3x3(A2) / D));
  const g3 = Math.max(0, Math.round(det3x3(A3) / D));

  return { g1, g2, g3, detA: D };
};
