import type { CatalogRelease, CatalogTrack } from '@vinyl/shared-types';

export interface ReleaseRow {
  discogs_release_id: string;
  title: string;
  year: number | null;
  main_artist_display: string | null;
  artists_json: unknown;
  formats_json: unknown;
  labels_json: unknown;
  import_id: string;
}

export interface TrackRow {
  id: string;
  discogs_release_id: string;
  ordinal: number;
  position: string | null;
  title: string;
  duration_text: string | null;
  type: string;
  artists_json: unknown;
  parent_ordinal: number | null;
}

export interface ReleaseWithTracks {
  release: CatalogRelease;
  tracks: CatalogTrack[];
}
