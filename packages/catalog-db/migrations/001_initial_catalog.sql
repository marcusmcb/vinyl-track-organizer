-- Up
CREATE TABLE catalog_imports (
  id            BIGSERIAL PRIMARY KEY,
  source_file   TEXT NOT NULL,
  source_date   DATE,
  checksum      TEXT,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  release_count INTEGER NOT NULL DEFAULT 0,
  track_count   INTEGER NOT NULL DEFAULT 0,
  malformed_count INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE releases (
  discogs_release_id  BIGINT PRIMARY KEY,
  title               TEXT NOT NULL,
  year                INTEGER,
  main_artist_display TEXT,
  artists_json        JSONB NOT NULL DEFAULT '[]',
  formats_json        JSONB NOT NULL DEFAULT '[]',
  labels_json         JSONB NOT NULL DEFAULT '[]',
  import_id           BIGINT NOT NULL REFERENCES catalog_imports(id) ON DELETE CASCADE
);

CREATE TABLE tracks (
  id                  BIGSERIAL PRIMARY KEY,
  discogs_release_id  BIGINT NOT NULL REFERENCES releases(discogs_release_id) ON DELETE CASCADE,
  ordinal             INTEGER NOT NULL,
  position            TEXT,
  title               TEXT NOT NULL,
  duration_text       TEXT,
  type                TEXT NOT NULL DEFAULT 'track' CHECK (type IN ('track','heading','index')),
  artists_json        JSONB NOT NULL DEFAULT '[]',
  parent_ordinal      INTEGER,
  UNIQUE (discogs_release_id, ordinal)
);

CREATE INDEX idx_tracks_release_ordinal ON tracks (discogs_release_id, ordinal);
CREATE INDEX idx_tracks_title ON tracks USING gin (to_tsvector('english', title));
CREATE INDEX idx_releases_title ON releases USING gin (to_tsvector('english', title));

-- Down
DROP TABLE IF EXISTS tracks;
DROP TABLE IF EXISTS releases;
DROP TABLE IF EXISTS catalog_imports;
