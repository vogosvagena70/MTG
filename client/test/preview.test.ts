import { describe, expect, it } from 'vitest';
import { focusedPreviewPosition, largeImageUrl, previewPosition } from '../src/lib/preview';

const viewport = { width: 1600, height: 900 };
const rect = (left: number, top: number, width = 150, height = 209) => ({
  left, top, right: left + width, bottom: top + height,
});

describe('previewPosition', () => {
  it('opens to the right of a card on the left side of the screen', () => {
    const pos = previewPosition(rect(100, 100), viewport);
    expect(pos.left).toBe(250 + 12);
    expect(pos.top).toBe(100);
    expect(pos.width).toBe(300);
  });

  it('opens to the left of a card on the right side of the screen', () => {
    const pos = previewPosition(rect(1300, 100), viewport);
    expect(pos.left + pos.width).toBe(1300 - 12);
  });

  it('never covers the hovered card when there is room on either side', () => {
    for (const x of [0, 400, 700, 1000, 1450]) {
      const r = rect(x, 200);
      const pos = previewPosition(r, viewport);
      const overlaps = pos.left < r.right && pos.left + pos.width > r.left;
      expect(overlaps).toBe(false);
    }
  });

  it('keeps the preview inside the viewport vertically', () => {
    const pos = previewPosition(rect(100, 800), viewport);
    expect(pos.top + pos.height).toBeLessThanOrEqual(900 - 8);
    expect(previewPosition(rect(100, -50), viewport).top).toBe(8);
  });

  it('shrinks on narrow screens and stays on screen', () => {
    const pos = previewPosition(rect(10, 10, 110, 153), { width: 360, height: 640 });
    expect(pos.width).toBeLessThanOrEqual(360 - 16);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + pos.width).toBeLessThanOrEqual(360 - 8);
  });
});

describe('focusedPreviewPosition', () => {
  it('fills the height of a wide window, centered, and is bigger than the regular preview', () => {
    const pos = focusedPreviewPosition(viewport);
    expect(pos.height).toBeGreaterThan(previewPosition(rect(100, 100), viewport).height);
    expect(pos.height).toBeLessThanOrEqual(viewport.height - 16);
    expect(pos.height).toBeGreaterThan(viewport.height - 20);
    expect(pos.left).toBe(Math.round((viewport.width - pos.width) / 2));
    expect(pos.top).toBe(Math.round((viewport.height - pos.height) / 2));
  });

  it('fits a narrow window by width', () => {
    const pos = focusedPreviewPosition({ width: 400, height: 900 });
    expect(pos.width).toBe(384);
    expect(pos.left).toBe(8);
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });
});

describe('largeImageUrl', () => {
  it('asks Scryfall for the large size of the same image', () => {
    expect(largeImageUrl('https://cards.scryfall.io/normal/front/a/b/ab.jpg?1')).toBe('https://cards.scryfall.io/large/front/a/b/ab.jpg?1');
  });
});
