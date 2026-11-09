/** Timing and display limits shared by the 3D and flat dice surfaces. */

/** How long landed dice stay visible before they fade. */
export const HOLD_MS = 2800;
/** How long the fade takes once the hold is over. */
export const FADE_MS = 600;
/** A flat roll tumbles and settles in about one second. */
export const FLAT_THROW_SECONDS = 1;
/** Reduced motion plays the whole throw in this long. The 3D physics is compressed to fit. */
export const REDUCED_MOTION_SECONDS = 0.6;
/**
 * Highest pixel ratio for a dice canvas. Above this, the full-screen layer costs much more GPU
 * time for little visible gain.
 */
export const MAX_PIXEL_RATIO = 1.5;

