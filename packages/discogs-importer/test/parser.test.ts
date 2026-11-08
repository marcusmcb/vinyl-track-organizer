import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseReleases } from '../src/parser.js';
import type { CatalogRelease } from '@vinyl/shared-types';

function streamFromString(xml: string): Readable {
  return Readable.from([xml]);
}

async function collectReleases(xml: string): Promise<CatalogRelease[]> {
  const releases: CatalogRelease[] = [];
  await parseReleases(streamFromString(xml), {
    onRelease(r) {
      releases.push(r);
    },
  });
  return releases;
}

describe('parseReleases', () => {
  it('parses a minimal release with one track', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="1">
    <title>Test Album</title>
    <artists><artist><id>1</id><name>Artist A</name></artist></artists>
    <year>2020</year>
    <tracklist>
      <track><position>A1</position><title>Track One</title><duration>3:30</duration></track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases).toHaveLength(1);
    expect(releases[0].discogsReleaseId).toBe(1);
    expect(releases[0].title).toBe('Test Album');
    expect(releases[0].year).toBe(2020);
    expect(releases[0].mainArtistDisplay).toBe('Artist A');
    expect(releases[0].tracks).toHaveLength(1);
    expect(releases[0].tracks[0]).toMatchObject({
      ordinal: 1,
      position: 'A1',
      title: 'Track One',
      durationText: '3:30',
      type: 'track',
    });
  });

  it('preserves track ordering and positions', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="2">
    <title>Multi Disc</title>
    <artists><artist><name>Artist B</name></artist></artists>
    <tracklist>
      <track><position>1-1</position><title>Disc 1 Track 1</title></track>
      <track><position>1-2</position><title>Disc 1 Track 2</title></track>
      <track><position>2-1</position><title>Disc 2 Track 1</title></track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].tracks.map((t) => t.position)).toEqual(['1-1', '1-2', '2-1']);
    expect(releases[0].tracks.map((t) => t.ordinal)).toEqual([1, 2, 3]);
  });

  it('handles missing durations and optional fields', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="3">
    <title>No Duration</title>
    <artists><artist><name>Artist C</name></artist></artists>
    <tracklist>
      <track><position>A1</position><title>No Duration Track</title></track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].tracks[0].durationText).toBeUndefined();
    expect(releases[0].year).toBeUndefined();
  });

  it('handles Unicode in titles and artist names', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="4">
    <title>Björk – Homogenic</title>
    <artists><artist><name>Björk</name></artist></artists>
    <tracklist>
      <track><position>A1</position><title>Jóga</title><duration>5:05</duration></track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].title).toBe('Björk – Homogenic');
    expect(releases[0].tracks[0].title).toBe('Jóga');
  });

  it('handles sub_tracks with parent ordinal', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="5">
    <title>Subtracks</title>
    <artists><artist><name>Artist D</name></artist></artists>
    <tracklist>
      <track>
        <position>A1</position>
        <title>Main Track</title>
        <sub_tracks>
          <track><position>A1a</position><title>Part 1</title></track>
          <track><position>A1b</position><title>Part 2</title></track>
        </sub_tracks>
      </track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].tracks).toHaveLength(3);
    expect(releases[0].tracks[0].title).toBe('Main Track');
    expect(releases[0].tracks[1].parentOrdinal).toBe(1);
    expect(releases[0].tracks[2].parentOrdinal).toBe(1);
  });

  it('handles track-level artists', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="6">
    <title>Various Artists</title>
    <artists><artist><name>Various</name></artist></artists>
    <tracklist>
      <track>
        <position>A1</position>
        <title>Track A</title>
        <artists><artist><name>Track Artist 1</name></artist></artists>
      </track>
      <track>
        <position>A2</position>
        <title>Track B</title>
        <artists><artist><name>Track Artist 2</name></artist></artists>
      </track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].tracks[0].artists[0].name).toBe('Track Artist 1');
    expect(releases[0].tracks[1].artists[0].name).toBe('Track Artist 2');
  });

  it('handles formats and labels', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="7">
    <title>Format Test</title>
    <artists><artist><name>Artist E</name></artist></artists>
    <formats>
      <format name="Vinyl" qty="2" text="Gatefold">
        <descriptions><description>LP</description><description>Album</description></descriptions>
      </format>
    </formats>
    <labels>
      <label name="Test Label" catno="TL001" id="42"/>
    </labels>
    <tracklist>
      <track><position>A1</position><title>T1</title></track>
    </tracklist>
  </release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases[0].formats[0]).toMatchObject({
      name: 'Vinyl',
      qty: 2,
      text: 'Gatefold',
      descriptions: ['LP', 'Album'],
    });
    expect(releases[0].labels[0]).toMatchObject({
      name: 'Test Label',
      catno: 'TL001',
      id: 42,
    });
  });

  it('skips malformed releases without failing the stream', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release><title>No ID</title></release>
  <release id="8"><title>Good</title><artists><artist><name>A</name></artist></artists></release>
</releases>`;
    const errors: Error[] = [];
    const releases: CatalogRelease[] = [];
    await parseReleases(streamFromString(xml), {
      onRelease(r) {
        releases.push(r);
      },
      onError(err) {
        errors.push(err);
      },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0].discogsReleaseId).toBe(8);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('parses multiple releases in sequence', async () => {
    const xml = `<?xml version="1.0"?>
<releases>
  <release id="10"><title>First</title><artists><artist><name>A</name></artist></artists></release>
  <release id="11"><title>Second</title><artists><artist><name>B</name></artist></artists></release>
  <release id="12"><title>Third</title><artists><artist><name>C</name></artist></artists></release>
</releases>`;
    const releases = await collectReleases(xml);
    expect(releases).toHaveLength(3);
    expect(releases.map((r) => r.discogsReleaseId)).toEqual([10, 11, 12]);
  });
});
