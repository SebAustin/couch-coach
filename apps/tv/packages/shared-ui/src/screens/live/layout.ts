/** Live screen regions in design px (1920x1080); wrap with `s()` when styling. */

/** The darker `stage` floor: everything left of the HUD column. */
export const STAGE_WIDTH = 1344;
/** The part of the stage inside the safe zone. */
export const STAGE_REGION = { x: 96, y: 54, width: 1200, height: 972 } as const;
/**
 * The auto-framed skeleton draws anywhere in here. It starts at the safe-zone corner, so the Connection pill sits on
 * top of it (rendered later); nothing else is drawn over that corner.
 */
export const SKELETON_VIEWPORT = { x: 96, y: 54, width: 1056, height: 972 } as const;
/** Kept free for the depth gauge, 32 px right of the skeleton viewport (ends at the stage region's edge). */
export const GAUGE_COLUMN = { x: 1184, width: 112 } as const;
