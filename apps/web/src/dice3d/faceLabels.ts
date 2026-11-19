/**
 * How a d10 is read. A plain d10 shows 1 to 10. The two dice of a d100 roll are read differently:
 * the units die shows 0 to 9, and the tens die shows 00 to 90. Together they give 1 to 100,
 * where 00 and 0 mean 100.
 */
export type FaceReading = 'tens' | 'units';

/** The text printed on a face. `value` is the face number from 1 to 10. */
export function faceLabel(value: number, reading?: FaceReading): string {
  if (reading === 'units') return String(value % 10);
  if (reading === 'tens') return String((value % 10) * 10).padStart(2, '0');
  return String(value);
}

/** The two d10 faces (1 to 10) that show a d100 result from 1 to 100. */
export function percentileFaces(value: number): { tens: number; units: number } {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError(`d100 result out of range: ${value}`);
  }
  const unitsDigit = value % 10;
  const tensDigit = Math.floor(value / 10) % 10;
  return { tens: tensDigit === 0 ? 10 : tensDigit, units: unitsDigit === 0 ? 10 : unitsDigit };
}
