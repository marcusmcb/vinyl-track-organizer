import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { from as copyFrom } from 'pg-copy-streams';
import type { Pool } from '@vinyl/catalog-db';
import { CatalogRepository } from '@vinyl/catalog-db';
import type { CatalogRelease, ImportResult } from '@vinyl/shared-types';
import { parseReleases } from './parser.js';

const BATCH_SIZE = 500;

function escapeCopyField(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function copyField(value: unknown): string {
  if (value === null || value === undefined) return '\\N';
  if (typeof value === 'string') return escapeCopyField(value);
  return String(value);
}

function releaseToCopyRow(release: CatalogRelease, importId: number): string {
  return [
    copyField(release.discogsReleaseId),
    copyField(release.title),
    copyField(release.year),
    copyField(release.mainArtistDisplay),
    copyField(JSON.stringify(release.artists)),
    copyField(JSON.stringify(release.formats)),
    copyField(JSON.stringify(release.labels)),
    copyField(importId),
  ].join('\t');
}

function trackToCopyRow(track: CatalogRelease['tracks'][number], releaseId: number): string {
  return [
    copyField(releaseId),
    copyField(track.ordinal),
    copyField(track.position),
    copyField(track.title),
    copyField(track.durationText),
    copyField(track.type),
    copyField(JSON.stringify(track.artists)),
    copyField(track.parentOrdinal),
  ].join('\t');
}

export async function importReleases(
  source: string | Readable,
  pool: Pool,
  options: { sourceFile: string; sourceDate?: string; checksum?: string }
): Promise<ImportResult> {
  const repo = new CatalogRepository(pool);
  const importId = await repo.createImport(options.sourceFile, options.sourceDate, options.checksum);
  const start = Date.now();

  let releasesProcessed = 0;
  let tracksProcessed = 0;
  let malformedReleases = 0;
  let releaseBatch: CatalogRelease[] = [];

  const flushBatch = async (): Promise<void> => {
    if (releaseBatch.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const releaseRows = releaseBatch.map((r) => releaseToCopyRow(r, importId)).join('\n') + '\n';
      const releaseStream = Readable.from([releaseRows]);
      const releaseCopy = client.query(
        copyFrom(
          `COPY releases (discogs_release_id, title, year, main_artist_display, artists_json, formats_json, labels_json, import_id) FROM STDIN`
        )
      );
      await pipeline(releaseStream, releaseCopy);

      const trackRows = releaseBatch
        .flatMap((r) => r.tracks.map((t) => trackToCopyRow(t, r.discogsReleaseId)))
        .join('\n');
      if (trackRows.length > 0) {
        const trackStream = Readable.from([trackRows + '\n']);
        const trackCopy = client.query(
          copyFrom(
            `COPY tracks (discogs_release_id, ordinal, position, title, duration_text, type, artists_json, parent_ordinal) FROM STDIN`
          )
        );
        await pipeline(trackStream, trackCopy);
      }

      await client.query('COMMIT');

      releasesProcessed += releaseBatch.length;
      tracksProcessed += releaseBatch.reduce((sum, r) => sum + r.tracks.length, 0);
      releaseBatch = [];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  try {
    await parseReleases(source, {
      async onRelease(release) {
        releaseBatch.push(release);
        if (releaseBatch.length >= BATCH_SIZE) {
          await flushBatch();
        }
      },
      onError(_err, _ctx) {
        malformedReleases++;
      },
    });

    await flushBatch();
    await repo.completeImport(importId, releasesProcessed, tracksProcessed, malformedReleases);
  } catch (err) {
    await repo.failImport(importId);
    throw err;
  }

  return {
    importId,
    releasesProcessed,
    tracksProcessed,
    malformedReleases,
    elapsedMs: Date.now() - start,
  };
}
