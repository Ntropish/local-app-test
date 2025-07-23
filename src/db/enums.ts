// It's a good practice to keep enums and other shared constants in separate files.

export const unitsOfMeasurement = [
  // Standard Units
  'grams',
  'kilograms',
  'ounces',
  'pounds',
  'cups',
  'tablespoons',
  'teaspoons',
  'pieces',
] as const

// We can infer the TypeScript type from the array
export type UnitOfMeasurement = (typeof unitsOfMeasurement)[number]
