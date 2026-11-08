#!/usr/bin/env node
import { createPool, runMigrations, CatalogRepository } from '@vinyl/catalog-db';
import { importReleases } from './importer.js';

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  const pool = createPool();

  try {
    switch (command) {
      case 'migrate': {
        console.log('Running migrations...');
        await runMigrations(pool);
        console.log('Migrations complete.');
        break;
      }

      case 'import': {
        const file = args[0];
        if (!file) {
          console.error('Usage: discogs-import import <file.xml|file.xml.gz> [--date YYYY-MM-DD] [--checksum SHA256]');
          process.exit(1);
        }
        const dateIdx = args.indexOf('--date');
        const checksumIdx = args.indexOf('--checksum');
        const sourceDate = dateIdx !== -1 ? args[dateIdx + 1] : undefined;
        const checksum = checksumIdx !== -1 ? args[checksumIdx + 1] : undefined;

        console.log(`Importing ${file}...`);
        const result = await importReleases(file, pool, {
          sourceFile: file,
          sourceDate,
          checksum,
        });
        console.log('Import complete:');
        console.log(`  Import ID:    ${result.importId}`);
        console.log(`  Releases:     ${result.releasesProcessed}`);
        console.log(`  Tracks:       ${result.tracksProcessed}`);
        console.log(`  Malformed:    ${result.malformedReleases}`);
        console.log(`  Elapsed:      ${result.elapsedMs}ms`);
        break;
      }

      case 'query': {
        const idArg = args[0];
        if (!idArg) {
          console.error('Usage: discogs-import query <release-id>');
          process.exit(1);
        }
        const releaseId = Number(idArg);
        if (!Number.isFinite(releaseId)) {
          console.error(`Invalid release ID: ${idArg}`);
          process.exit(1);
        }

        const repo = new CatalogRepository(pool);
        const result = await repo.getReleaseWithTracks(releaseId);
        if (!result) {
          console.log(`Release ${releaseId} not found.`);
          process.exit(1);
        }

        const { release, tracks } = result;
        console.log(`Release ${release.discogsReleaseId}: ${release.title}`);
        if (release.mainArtistDisplay) console.log(`  Artist: ${release.mainArtistDisplay}`);
        if (release.year) console.log(`  Year:   ${release.year}`);
        if (release.formats.length > 0) {
          console.log(`  Format: ${release.formats.map((f) => `${f.qty ?? 1}x ${f.name}`).join(', ')}`);
        }
        if (release.labels.length > 0) {
          console.log(`  Label:  ${release.labels.map((l) => `${l.name} (${l.catno ?? 'no catno'})`).join(', ')}`);
        }
        console.log(`  Tracks (${tracks.length}):`);
        for (const t of tracks) {
          const pos = t.position ? `[${t.position}]` : '[--]';
          const dur = t.durationText ? ` (${t.durationText})` : '';
          const type = t.type !== 'track' ? ` <${t.type}>` : '';
          const sub = t.parentOrdinal !== undefined ? `  ↳ sub of #${t.parentOrdinal}` : '';
          console.log(`    ${t.ordinal}. ${pos} ${t.title}${dur}${type}${sub}`);
        }
        break;
      }

      default:
        console.log('Usage: discogs-import <command>');
        console.log('');
        console.log('Commands:');
        console.log('  migrate              Run database migrations');
        console.log('  import <file>        Import a Discogs releases XML or XML.gz file');
        console.log('  query <release-id>   Query a release and its tracklist by Discogs release ID');
        break;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
