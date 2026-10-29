export const GIVEN_NAMES = ['Ada', 'Milo', 'Nora', 'Iris', 'Theo', 'Lena', 'Owen', 'Zara'] as const;
export const FAMILY_NAMES = ['Chen', 'Reed', 'Patel', 'Wood', 'Hall', 'Kim', 'Lopez', 'Brown'] as const;
export const CITIES = ['New York', 'Boston', 'Portland', 'Austin'] as const;
export const COUNTRIES = ['US', 'GB', 'DE', 'CA', 'NA'] as const;
export const PRODUCTS = ['iPhone', 'Desk Lamp', 'Travel Bag', 'Coffee Cup', 'Notebook'] as const;
export const STATUSES = ['pending', 'pending review', 'complete', 'cancelled'] as const;

/** Mulberry32 with an explicit uint32 state; no clock, global entropy or external dependency. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function choose<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}
