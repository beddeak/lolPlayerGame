import type { Point, UnitState } from './contracts';

interface Entry {
  unit: UnitState;
  order: number;
  x: number;
  y: number;
}

const finitePoint = (point: Point): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * Ephemeral read-only acceleration for ONE movement/combat snapshot. Never stored
 * in a checkpoint and never used as visibility authority. Consumers still check
 * side, lifecycle, LOS, actual attack range and structure prerequisites.
 *
 * Results retain the original snapshot order exactly: filtering through this
 * index cannot change stable sort ties, RNG draws, or resolution precedence.
 */
export class UnitSpatialIndex {
  private readonly entries: Entry[];
  private readonly cells = new Map<string, Entry[]>();

  constructor(
    units: readonly UnitState[],
    private readonly cellSize = 800,
  ) {
    if (!Number.isFinite(cellSize) || cellSize <= 0)
      throw new RangeError('Spatial cell size must be finite and positive');
    this.entries = units.map((unit, order) => {
      if (!finitePoint(unit.position))
        throw new RangeError('Spatial positions must be finite');
      const entry = { unit, order, x: unit.position.x, y: unit.position.y };
      const key = `${Math.floor(entry.x / cellSize)}:${Math.floor(entry.y / cellSize)}`;
      const cell = this.cells.get(key);
      if (cell) cell.push(entry);
      else this.cells.set(key, [entry]);
      return entry;
    });
  }

  within(point: Point, radius: number): UnitState[] {
    if (!finitePoint(point) || !Number.isFinite(radius) || radius < 0)
      throw new RangeError(
        'Spatial query requires a finite point and nonnegative radius',
      );
    if (!this.entries.length) return [];
    const minX = Math.floor((point.x - radius) / this.cellSize);
    const maxX = Math.floor((point.x + radius) / this.cellSize);
    const minY = Math.floor((point.y - radius) / this.cellSize);
    const maxY = Math.floor((point.y + radius) / this.cellSize);
    const inside = (entry: Entry) =>
      Math.hypot(point.x - entry.x, point.y - entry.y) <= radius;
    // Wide queries must not iterate an enormous empty grid; a linear scan is exact.
    if (
      ![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
      (maxX - minX + 1) * (maxY - minY + 1) > this.cells.size * 4
    )
      return this.entries.filter(inside).map((entry) => entry.unit);
    const found: Entry[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (const entry of this.cells.get(`${x}:${y}`) ?? []) {
          if (inside(entry)) found.push(entry);
        }
      }
    }
    found.sort((a, b) => a.order - b.order);
    return found.map((entry) => entry.unit);
  }
}
