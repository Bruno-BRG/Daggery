/** Die colour schemes. Hope and Fear are the two Duality dice; the rest are shown by their role. */
export type ColorwayId = 'hope' | 'fear' | 'advantage' | 'disadvantage' | 'neutral';

export interface Colorway {
  /** Die body colour. */
  body: string;
  /** Numeral fill. */
  numeral: string;
  /** Numeral outline, for legibility against the body. */
  outline: string;
}

export const COLORWAYS: Record<ColorwayId, Colorway> = {
  hope: { body: '#e3b04b', numeral: '#fffdf5', outline: '#6b4a10' },
  fear: { body: '#3a0f41', numeral: '#ff6f7f', outline: '#12000f' },
  advantage: { body: '#2f8a69', numeral: '#f4fff9', outline: '#0e3b2b' },
  disadvantage: { body: '#5a5f70', numeral: '#f2f2f7', outline: '#1f2130' },
  neutral: { body: '#d9d4c7', numeral: '#1f1d24', outline: '#8c877c' },
};
