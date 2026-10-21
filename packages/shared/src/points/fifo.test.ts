import { describe, expect, it } from 'vitest';
import { consumePointsFIFO } from './fifo.js';

const batch = (entryId: string, remainingPoints: number, expiresAt: string) => ({
  entryId,
  points: remainingPoints,
  remainingPoints,
  expiresAt: new Date(expiresAt),
});

describe('consumePointsFIFO', () => {
  it('takes the oldest batch first', () => {
    const r = consumePointsFIFO(
      [
        batch('new', 10, '2026-07-01T00:00:00Z'),
        batch('old', 10, '2026-06-01T00:00:00Z'),
      ],
      4,
    );
    expect(r.consumed).toEqual([{ entryId: 'old', points: 4 }]);
    expect(r.shortfall).toBe(0);
  });

  it('spreads consumption across two batches', () => {
    const r = consumePointsFIFO(
      [
        batch('old', 10, '2026-06-01T00:00:00Z'),
        batch('new', 10, '2026-07-01T00:00:00Z'),
      ],
      15,
    );
    expect(r.consumed).toEqual([
      { entryId: 'old', points: 10 },
      { entryId: 'new', points: 5 },
    ]);
    expect(r.shortfall).toBe(0);
  });

  it('reports a shortfall when there are not enough points', () => {
    const r = consumePointsFIFO([batch('old', 5, '2026-06-01T00:00:00Z')], 8);
    expect(r.consumed).toEqual([{ entryId: 'old', points: 5 }]);
    expect(r.shortfall).toBe(3);
  });

  it('orders batches that expire on the same date deterministically by entry id', () => {
    const r = consumePointsFIFO(
      [
        batch('b', 10, '2026-06-01T00:00:00Z'),
        batch('a', 10, '2026-06-01T00:00:00Z'),
      ],
      10,
    );
    expect(r.consumed).toEqual([{ entryId: 'a', points: 10 }]);
  });

  it('ignores batches with no remaining points', () => {
    const r = consumePointsFIFO(
      [
        {
          entryId: 'empty',
          points: 0,
          remainingPoints: 0,
          expiresAt: new Date('2026-06-01T00:00:00Z'),
        },
        batch('full', 10, '2026-07-01T00:00:00Z'),
      ],
      5,
    );
    expect(r.consumed).toEqual([{ entryId: 'full', points: 5 }]);
  });
});
