import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { SaxesParser } from 'saxes';
import type { Readable } from 'node:stream';
import type {
  CatalogRelease,
  CatalogTrack,
  DiscogsArtistCredit,
  DiscogsFormat,
  DiscogsLabel,
  TrackType,
} from '@vinyl/shared-types';

export interface ParserEvents {
  onRelease(release: CatalogRelease): void | Promise<void>;
  onError?(error: Error, context: { releaseId?: number }): void;
}

interface ParseContext {
  releaseId?: number;
  title?: string;
  year?: number;
  artists: DiscogsArtistCredit[];
  extraArtists: DiscogsArtistCredit[];
  formats: DiscogsFormat[];
  labels: DiscogsLabel[];
  tracks: CatalogTrack[];
  currentTrack?: Partial<CatalogTrack> & { artists: DiscogsArtistCredit[] };
  currentArtist?: Partial<DiscogsArtistCredit>;
  currentFormat?: Partial<DiscogsFormat> & { descriptions: string[] };
  currentLabel?: Partial<DiscogsLabel>;
  trackOrdinal: number;
  inTracklist: boolean;
  inSubTracks: boolean;
  subTrackParentOrdinal?: number;
  textBuffer: string;
  malformed: boolean;
}

function emptyContext(): ParseContext {
  return {
    artists: [],
    extraArtists: [],
    formats: [],
    labels: [],
    tracks: [],
    trackOrdinal: 0,
    inTracklist: false,
    inSubTracks: false,
    textBuffer: '',
    malformed: false,
  };
}

function text(ctx: ParseContext): string {
  return ctx.textBuffer.trim();
}

function num(text: string): number | undefined {
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export async function parseReleases(
  source: string | Readable,
  events: ParserEvents
): Promise<{ releases: number; tracks: number; malformed: number }> {
  const stream =
    typeof source === 'string'
      ? source.endsWith('.gz')
        ? createReadStream(source).pipe(createGunzip())
        : createReadStream(source)
      : source;

  const parser = new SaxesParser({ xmlns: false });
  let ctx = emptyContext();
  let releases = 0;
  let tracks = 0;
  let malformed = 0;
  const path: string[] = [];

  const flushText = (): void => {
    ctx.textBuffer = '';
  };

  parser.on('opentag', (tag) => {
    const name = tag.name;
    path.push(name);
    flushText();

    switch (name) {
      case 'release':
        ctx = emptyContext();
        ctx.releaseId = num(tag.attributes.id as string);
        if (ctx.releaseId === undefined) {
          ctx.malformed = true;
        }
        break;

      case 'tracklist':
        ctx.inTracklist = true;
        break;

      case 'track':
        if (ctx.inTracklist) {
          ctx.currentTrack = { artists: [] };
        }
        break;

      case 'sub_tracks':
        ctx.inSubTracks = true;
        // The parent track's ordinal is the next one to be assigned.
        ctx.subTrackParentOrdinal = ctx.trackOrdinal + 1;
        // Finalize the parent track now so it appears before its sub-tracks.
        if (ctx.currentTrack && ctx.inTracklist) {
          ctx.trackOrdinal++;
          ctx.tracks.push({
            ordinal: ctx.trackOrdinal,
            position: ctx.currentTrack.position,
            title: ctx.currentTrack.title ?? '',
            durationText: ctx.currentTrack.durationText,
            type: ctx.currentTrack.type ?? 'track',
            artists: ctx.currentTrack.artists,
            parentOrdinal: undefined,
          });
          ctx.currentTrack = undefined;
        }
        break;

      case 'artist':
        ctx.currentArtist = {};
        break;

      case 'format':
        ctx.currentFormat = { descriptions: [] };
        if (tag.attributes.name) ctx.currentFormat.name = String(tag.attributes.name);
        if (tag.attributes.qty) ctx.currentFormat.qty = num(String(tag.attributes.qty));
        if (tag.attributes.text) ctx.currentFormat.text = String(tag.attributes.text);
        break;

      case 'label':
        ctx.currentLabel = {};
        if (tag.attributes.id) ctx.currentLabel.id = num(String(tag.attributes.id));
        if (tag.attributes.name) ctx.currentLabel.name = String(tag.attributes.name);
        if (tag.attributes.catno) ctx.currentLabel.catno = String(tag.attributes.catno);
        break;
    }
  });

  parser.on('text', (t) => {
    ctx.textBuffer += t;
  });

  parser.on('cdata', (t) => {
    ctx.textBuffer += t;
  });

  parser.on('closetag', (tag) => {
    const name = tag.name;
    const parent = path[path.length - 2];
    const value = text(ctx);

    switch (name) {
      case 'release': {
        if (ctx.malformed || ctx.releaseId === undefined) {
          malformed++;
          events.onError?.(new Error('Malformed release: missing or invalid id'), {
            releaseId: ctx.releaseId,
          });
        } else {
          const release: CatalogRelease = {
            discogsReleaseId: ctx.releaseId,
            title: ctx.title ?? '',
            year: ctx.year,
            mainArtistDisplay: ctx.artists.map((a) => a.name).join(', ') || undefined,
            artists: ctx.artists,
            formats: ctx.formats,
            labels: ctx.labels,
            tracks: ctx.tracks,
          };
          releases++;
          tracks += ctx.tracks.length;
          const result = events.onRelease(release);
          if (result instanceof Promise) {
            // Backpressure: pause the stream until the consumer finishes.
            stream.pause();
            result
              .then(() => stream.resume())
              .catch((err) => {
                events.onError?.(err as Error, { releaseId: ctx.releaseId });
                stream.resume();
              });
          }
        }
        ctx = emptyContext();
        break;
      }

      case 'title':
        if (ctx.currentTrack && ctx.inTracklist) {
          ctx.currentTrack.title = value;
        } else if (parent === 'release' && !ctx.inTracklist) {
          ctx.title = value;
        }
        break;

      case 'year':
        if (parent === 'release') {
          ctx.year = num(value);
        }
        break;

      case 'position':
        if (ctx.currentTrack) ctx.currentTrack.position = value || undefined;
        break;

      case 'duration':
        if (ctx.currentTrack) ctx.currentTrack.durationText = value || undefined;
        break;

      case 'type':
        if (ctx.currentTrack) {
          const v = value.toLowerCase();
          ctx.currentTrack.type = (v === 'heading' || v === 'index' ? v : 'track') as TrackType;
        }
        break;

      case 'name':
        if (ctx.currentArtist) {
          ctx.currentArtist.name = value;
        }
        break;

      case 'anv':
        if (ctx.currentArtist) ctx.currentArtist.anv = value || undefined;
        break;

      case 'role':
        if (ctx.currentArtist) ctx.currentArtist.role = value || undefined;
        break;

      case 'join':
        if (ctx.currentArtist) ctx.currentArtist.join = value || undefined;
        break;

      case 'id':
        if (ctx.currentArtist) ctx.currentArtist.id = num(value);
        break;

      case 'description':
        if (ctx.currentFormat && parent === 'descriptions') {
          ctx.currentFormat.descriptions.push(value);
        }
        break;

      case 'artist':
        if (ctx.currentArtist?.name) {
          const artist = ctx.currentArtist as DiscogsArtistCredit;
          if (ctx.currentTrack && ctx.inTracklist) {
            ctx.currentTrack.artists.push(artist);
          } else if (parent === 'extraartists') {
            ctx.extraArtists.push(artist);
          } else {
            ctx.artists.push(artist);
          }
        }
        ctx.currentArtist = undefined;
        break;

      case 'format':
        if (ctx.currentFormat?.name) {
          ctx.formats.push(ctx.currentFormat as DiscogsFormat);
        }
        ctx.currentFormat = undefined;
        break;

      case 'label':
        if (ctx.currentLabel?.name) {
          ctx.labels.push(ctx.currentLabel as DiscogsLabel);
        }
        ctx.currentLabel = undefined;
        break;

      case 'track': {
        if (ctx.currentTrack && ctx.inTracklist) {
          ctx.trackOrdinal++;
          const track: CatalogTrack = {
            ordinal: ctx.trackOrdinal,
            position: ctx.currentTrack.position,
            title: ctx.currentTrack.title ?? '',
            durationText: ctx.currentTrack.durationText,
            type: ctx.currentTrack.type ?? 'track',
            artists: ctx.currentTrack.artists,
            parentOrdinal: ctx.inSubTracks ? ctx.subTrackParentOrdinal : undefined,
          };
          ctx.tracks.push(track);
        }
        ctx.currentTrack = undefined;
        break;
      }

      case 'sub_tracks':
        ctx.inSubTracks = false;
        ctx.subTrackParentOrdinal = undefined;
        break;

      case 'tracklist':
        ctx.inTracklist = false;
        break;
    }

    path.pop();
    flushText();
  });

  parser.on('error', (err) => {
    events.onError?.(err as Error, { releaseId: ctx.releaseId });
  });

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      try {
        parser.write(chunk.toString('utf8'));
      } catch (err) {
        reject(err);
      }
    });
    stream.on('end', () => {
      try {
        parser.close();
        resolve({ releases, tracks, malformed });
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', reject);
  });
}
