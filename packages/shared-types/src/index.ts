export interface DiscogsArtistCredit {
  id?: number;
  name: string;
  anv?: string;
  role?: string;
  join?: string;
}

export interface DiscogsFormat {
  name: string;
  qty?: number;
  text?: string;
  descriptions?: string[];
}

export interface DiscogsLabel {
  id?: number;
  name: string;
  catno?: string;
}

export type TrackType = 'track' | 'heading' | 'index';

export interface CatalogTrack {
  ordinal: number;
  position?: string;
  title: string;
  durationText?: string;
  type: TrackType;
  artists: DiscogsArtistCredit[];
  parentOrdinal?: number;
}

export interface CatalogRelease {
  discogsReleaseId: number;
  title: string;
  year?: number;
  mainArtistDisplay?: string;
  artists: DiscogsArtistCredit[];
  formats: DiscogsFormat[];
  labels: DiscogsLabel[];
  tracks: CatalogTrack[];
}

export interface ImportResult {
  importId: number;
  releasesProcessed: number;
  tracksProcessed: number;
  malformedReleases: number;
  elapsedMs: number;
}
