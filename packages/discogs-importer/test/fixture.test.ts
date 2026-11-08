import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseReleases } from '../src/parser.js';
import type { CatalogRelease } from '@vinyl/shared-types';

const fixturePath = join(__dirname, '../../../fixtures/discogs-releases-small.xml');
const edgeCasePath = join(__dirname, '../../../fixtures/discogs-releases-edge-cases.xml');

async function collectFromFile(path: string): Promise<CatalogRelease[]> {
  const xml = readFileSync(path, 'utf8');
  const releases: CatalogRelease[] = [];
  await parseReleases(Readable.from([xml]), {
    onRelease(r) {
      releases.push(r);
    },
  });
  return releases;
}

describe('real Discogs fixture', () => {
  it('parses all 100 releases from the small fixture', async () => {
    const releases = await collectFromFile(fixturePath);
    expect(releases).toHaveLength(100);
  });

  it('every release has an id, title, and at least one track', async () => {
    const releases = await collectFromFile(fixturePath);
    for (const r of releases) {
      expect(r.discogsReleaseId).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.tracks.length).toBeGreaterThan(0);
    }
  });

  it('track ordinals are sequential within each release', async () => {
    const releases = await collectFromFile(fixturePath);
    for (const r of releases) {
      r.tracks.forEach((t, i) => {
        expect(t.ordinal).toBe(i + 1);
      });
    }
  });

  it('parses edge-case fixture with subtracks and missing durations', async () => {
    const releases = await collectFromFile(edgeCasePath);
    expect(releases.length).toBeGreaterThanOrEqual(3);

    const subtrackRelease = releases.find((r) => r.discogsReleaseId === 723);
    expect(subtrackRelease).toBeDefined();
    const subTracks = subtrackRelease!.tracks.filter((t) => t.parentOrdinal !== undefined);
    expect(subTracks.length).toBeGreaterThan(0);

    const noDurationRelease = releases.find((r) => r.discogsReleaseId === 13);
    expect(noDurationRelease).toBeDefined();
    const tracksWithoutDuration = noDurationRelease!.tracks.filter((t) => !t.durationText);
    expect(tracksWithoutDuration.length).toBeGreaterThan(0);
  });
});
