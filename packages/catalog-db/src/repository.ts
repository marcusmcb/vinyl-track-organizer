import type { Pool } from './pool.js';
import type { ReleaseWithTracks, ReleaseRow, TrackRow } from './types.js';
import type { CatalogRelease, CatalogTrack } from '@vinyl/shared-types';

export class CatalogRepository {
  constructor(private readonly pool: Pool) {}

  async getReleaseWithTracks(discogsReleaseId: number): Promise<ReleaseWithTracks | null> {
    const releaseResult = await this.pool.query<ReleaseRow>(
      `SELECT discogs_release_id, title, year, main_artist_display,
              artists_json, formats_json, labels_json, import_id
         FROM releases
        WHERE discogs_release_id = $1`,
      [discogsReleaseId]
    );

    if (releaseResult.rows.length === 0) {
      return null;
    }

    const r = releaseResult.rows[0];
    const release: CatalogRelease = {
      discogsReleaseId: Number(r.discogs_release_id),
      title: r.title,
      year: r.year ?? undefined,
      mainArtistDisplay: r.main_artist_display ?? undefined,
      artists: (r.artists_json as CatalogRelease['artists']) ?? [],
      formats: (r.formats_json as CatalogRelease['formats']) ?? [],
      labels: (r.labels_json as CatalogRelease['labels']) ?? [],
      tracks: [],
    };

    const trackResult = await this.pool.query<TrackRow>(
      `SELECT id, discogs_release_id, ordinal, position, title,
              duration_text, type, artists_json, parent_ordinal
         FROM tracks
        WHERE discogs_release_id = $1
        ORDER BY ordinal`,
      [discogsReleaseId]
    );

    const tracks: CatalogTrack[] = trackResult.rows.map((t) => ({
      ordinal: t.ordinal,
      position: t.position ?? undefined,
      title: t.title,
      durationText: t.duration_text ?? undefined,
      type: t.type as CatalogTrack['type'],
      artists: (t.artists_json as CatalogTrack['artists']) ?? [],
      parentOrdinal: t.parent_ordinal ?? undefined,
    }));

    release.tracks = tracks;
    return { release, tracks };
  }

  async createImport(sourceFile: string, sourceDate?: string, checksum?: string): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO catalog_imports (source_file, source_date, checksum, status)
       VALUES ($1, $2, $3, 'running')
       RETURNING id`,
      [sourceFile, sourceDate ?? null, checksum ?? null]
    );
    return Number(result.rows[0].id);
  }

  async completeImport(
    importId: number,
    releaseCount: number,
    trackCount: number,
    malformedCount: number
  ): Promise<void> {
    await this.pool.query(
      `UPDATE catalog_imports
          SET status = 'completed',
              release_count = $2,
              track_count = $3,
              malformed_count = $4,
              completed_at = now()
        WHERE id = $1`,
      [importId, releaseCount, trackCount, malformedCount]
    );
  }

  async failImport(importId: number): Promise<void> {
    await this.pool.query(
      `UPDATE catalog_imports SET status = 'failed', completed_at = now() WHERE id = $1`,
      [importId]
    );
  }
}
