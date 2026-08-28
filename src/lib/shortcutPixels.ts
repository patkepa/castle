import type { CSSProperties } from "react";
import type { Shortcut } from "../generated/castle_contracts";

export type { Shortcut } from "../generated/castle_contracts";

interface IndexedShortcut {
  shortcut: Shortcut;
  variantIndex: number;
}

interface ShortcutGroup {
  category: string;
  items: IndexedShortcut[];
}

const distinctBaseHues = [
  204, 18, 142, 288, 54, 232, 96, 332, 176, 30, 258, 118, 304, 70, 214, 350,
];
const shortcutPixelGridSize = 10;
const transparentPixel = "transparent";
const tetrominoShapes: Array<Array<[number, number]>> = [
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
];
const pixelDirections: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function groupShortcuts(
  shortcuts: readonly Shortcut[],
): ShortcutGroup[] {
  const groups = new Map<string, ShortcutGroup>();

  shortcuts.forEach((shortcut, variantIndex) => {
    const group = groups.get(shortcut.category);
    const item = { shortcut, variantIndex };

    if (group) {
      group.items.push(item);
    } else {
      groups.set(shortcut.category, {
        category: shortcut.category,
        items: [item],
      });
    }
  });

  return Array.from(groups.values());
}

export function getShortcutSeed(shortcut: Shortcut) {
  return Array.from(
    `${shortcut.category}:${shortcut.label}:${shortcut.href}`,
  ).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 9973;
  }, 17);
}

function getShortcutCategorySeed(category: string) {
  return Array.from(category).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 9973;
  }, 17);
}

function getShortcutCategoryHue(category: string, categoryIndex: number) {
  const seed = getShortcutCategorySeed(category);
  const hue = distinctBaseHues[categoryIndex % distinctBaseHues.length];
  const cycleOffset =
    Math.floor(categoryIndex / distinctBaseHues.length) * 23 + (seed % 9) - 4;

  return (hue + cycleOffset + 360) % 360;
}

function getShortcutCategoryPalette(
  category: string,
  categoryIndex: number,
) {
  const seed = getShortcutCategorySeed(category);
  const baseHue = getShortcutCategoryHue(category, categoryIndex);
  const hueSpread = 12 + (seed % 12);

  return [
    `hsl(${baseHue} 58% 50% / 0.34)`,
    `hsl(${(baseHue + hueSpread) % 360} 56% 45% / 0.3)`,
    `hsl(${(baseHue - hueSpread + 360) % 360} 46% 55% / 0.27)`,
  ];
}

export function getShortcutCategoryStyle(
  category: string,
  categoryIndex: number,
): CSSProperties {
  const baseHue = getShortcutCategoryHue(category, categoryIndex);
  const seed = getShortcutCategorySeed(category);
  const hueSpread = 12 + (seed % 12);

  return {
    "--tile-hue-a": `${baseHue}`,
    "--tile-hue-b": `${(baseHue + hueSpread) % 360}`,
    "--tile-hue-c": `${(baseHue - hueSpread + 360) % 360}`,
  } as CSSProperties;
}

function nextPixelSeed(seed: number) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function rotatePixelShape(
  shape: Array<[number, number]>,
  rotation: number,
) {
  let rotatedShape = shape.map(([x, y]) => [x, y] as [number, number]);

  for (let index = 0; index < rotation; index += 1) {
    rotatedShape = rotatedShape.map(([x, y]) => [y, -x]);
  }

  const minX = Math.min(...rotatedShape.map(([x]) => x));
  const minY = Math.min(...rotatedShape.map(([, y]) => y));

  return rotatedShape.map(([x, y]) => {
    return [x - minX, y - minY] as [number, number];
  });
}

function getPixelIndex(x: number, y: number) {
  return y * shortcutPixelGridSize + x;
}

export function getShortcutPixels(
  shortcut: Shortcut,
  variantIndex: number,
  categoryIndex: number,
) {
  let seed =
    (getShortcutSeed(shortcut) * 97 +
      variantIndex * 157 +
      categoryIndex * 389) >>>
    0;
  const palette = getShortcutCategoryPalette(shortcut.category, categoryIndex);
  const pixels = Array.from(
    { length: shortcutPixelGridSize * shortcutPixelGridSize },
    () => transparentPixel,
  );

  const nextInteger = (max: number) => {
    seed = nextPixelSeed(seed);
    return seed % max;
  };
  const setPixel = (x: number, y: number, color: string) => {
    if (
      x < 0 ||
      y < 0 ||
      x >= shortcutPixelGridSize ||
      y >= shortcutPixelGridSize
    ) {
      return;
    }

    pixels[getPixelIndex(x, y)] = color;
  };

  const pieceCount = 5 + nextInteger(5);
  for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
    const shape = rotatePixelShape(
      tetrominoShapes[nextInteger(tetrominoShapes.length)],
      nextInteger(4),
    );
    const width = Math.max(...shape.map(([x]) => x)) + 1;
    const height = Math.max(...shape.map(([, y]) => y)) + 1;
    const originX = nextInteger(shortcutPixelGridSize - width + 1);
    const originY = nextInteger(shortcutPixelGridSize - height + 1);
    const colorOffset = nextInteger(palette.length);

    shape.forEach(([x, y], pointIndex) => {
      setPixel(
        originX + x,
        originY + y,
        palette[(colorOffset + pointIndex) % palette.length],
      );
    });
  }

  const pathCount = 2 + nextInteger(4);
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    let x = nextInteger(shortcutPixelGridSize);
    let y = nextInteger(shortcutPixelGridSize);
    let directionIndex = nextInteger(pixelDirections.length);
    const pathLength = 5 + nextInteger(12);

    for (let stepIndex = 0; stepIndex < pathLength; stepIndex += 1) {
      const color = palette[(pathIndex + stepIndex) % palette.length];
      const [directionX, directionY] = pixelDirections[directionIndex];

      setPixel(x, y, color);

      if (nextInteger(100) < 28) {
        const branchDirection = nextInteger(2) === 0 ? 1 : -1;
        setPixel(
          x + directionY * branchDirection,
          y - directionX * branchDirection,
          color,
        );
      }

      if (nextInteger(100) < 42) {
        directionIndex =
          (directionIndex + (nextInteger(2) === 0 ? 1 : 3)) %
          pixelDirections.length;
      }

      const [nextX, nextY] = pixelDirections[directionIndex];
      x += nextX;
      y += nextY;

      if (
        x < 0 ||
        y < 0 ||
        x >= shortcutPixelGridSize ||
        y >= shortcutPixelGridSize
      ) {
        x = Math.min(Math.max(x, 0), shortcutPixelGridSize - 1);
        y = Math.min(Math.max(y, 0), shortcutPixelGridSize - 1);
        directionIndex = (directionIndex + 2) % pixelDirections.length;
      }
    }
  }

  const carveCount = 5 + nextInteger(8);
  for (let index = 0; index < carveCount; index += 1) {
    const startX = nextInteger(shortcutPixelGridSize);
    const startY = nextInteger(shortcutPixelGridSize);
    const [directionX, directionY] = pixelDirections[nextInteger(4)];
    const length = 1 + nextInteger(3);

    for (let stepIndex = 0; stepIndex < length; stepIndex += 1) {
      const x = startX + directionX * stepIndex;
      const y = startY + directionY * stepIndex;

      if (
        x >= 0 &&
        y >= 0 &&
        x < shortcutPixelGridSize &&
        y < shortcutPixelGridSize
      ) {
        pixels[getPixelIndex(x, y)] = transparentPixel;
      }
    }
  }

  const densityRoll = nextInteger(100);
  const targetFilled =
    densityRoll < 18
      ? 8 + nextInteger(13)
      : densityRoll < 38
        ? 21 + nextInteger(17)
        : densityRoll < 65
          ? 38 + nextInteger(20)
          : densityRoll < 86
            ? 58 + nextInteger(18)
            : 76 + nextInteger(17);
  let filledCount = pixels.filter((color) => color !== transparentPixel).length;

  while (filledCount > targetFilled) {
    const index = nextInteger(pixels.length);
    if (pixels[index] !== transparentPixel) {
      pixels[index] = transparentPixel;
      filledCount -= 1;
    }
  }

  while (filledCount < targetFilled) {
    const index = nextInteger(pixels.length);
    if (pixels[index] === transparentPixel) {
      pixels[index] = palette[nextInteger(palette.length)];
      filledCount += 1;
    }
  }

  return pixels;
}

function getAdjacentEmptyPixelIndexes(index: number, pixels: string[]) {
  const column = index % shortcutPixelGridSize;
  const adjacentIndexes: number[] = [];

  if (column > 0) {
    adjacentIndexes.push(index - 1);
  }

  if (column < shortcutPixelGridSize - 1) {
    adjacentIndexes.push(index + 1);
  }

  if (index >= shortcutPixelGridSize) {
    adjacentIndexes.push(index - shortcutPixelGridSize);
  }

  if (index < pixels.length - shortcutPixelGridSize) {
    adjacentIndexes.push(index + shortcutPixelGridSize);
  }

  return adjacentIndexes.filter((adjacentIndex) => {
    return pixels[adjacentIndex] === transparentPixel;
  });
}

function moveShortcutPixelIntoEmptyCell(pixels: string[], seed: number) {
  let nextSeed = nextPixelSeed(seed);
  const moves: Array<{ from: number; to: number }> = [];

  pixels.forEach((color, index) => {
    if (color === transparentPixel) {
      return;
    }

    getAdjacentEmptyPixelIndexes(index, pixels).forEach((emptyIndex) => {
      moves.push({ from: index, to: emptyIndex });
    });
  });

  if (moves.length === 0) {
    return { pixels, seed: nextSeed };
  }

  const move = moves[nextSeed % moves.length];
  const movedPixels = [...pixels];
  movedPixels[move.to] = movedPixels[move.from];
  movedPixels[move.from] = transparentPixel;
  nextSeed = nextPixelSeed(nextSeed + move.from * 31 + move.to * 17);

  return { pixels: movedPixels, seed: nextSeed };
}

export function moveShortcutPixelsIntoEmptyCells(
  pixels: string[],
  seed: number,
) {
  let nextSeed = nextPixelSeed(seed);
  const moveCount = 1 + (nextSeed % 4);
  let movedPixels = pixels;

  for (let index = 0; index < moveCount; index += 1) {
    const moved = moveShortcutPixelIntoEmptyCell(movedPixels, nextSeed);
    movedPixels = moved.pixels;
    nextSeed = moved.seed;
  }

  return { pixels: movedPixels, seed: nextSeed };
}
