export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PreviewPosition {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MAX_WIDTH = 300;
const GAP = 12; // space between the hovered card and the preview
const MARGIN = 8; // minimum distance from the viewport edge
const CARD_ASPECT = 680 / 488; // height / width of a Scryfall "normal" image

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Places the enlarged preview beside the hovered card, on whichever side has more room,
 * top-aligned with the card and kept inside the viewport.
 */
export function previewPosition(card: Box, viewport: Viewport): PreviewPosition {
  const width = Math.min(MAX_WIDTH, viewport.width - 2 * MARGIN);
  const height = Math.round(width * CARD_ASPECT);
  const roomRight = viewport.width - card.right;
  const roomLeft = card.left;
  const left = roomRight >= roomLeft ? card.right + GAP : card.left - GAP - width;
  return {
    left: clamp(left, MARGIN, viewport.width - MARGIN - width),
    top: clamp(card.top, MARGIN, viewport.height - MARGIN - height),
    width,
    height,
  };
}
