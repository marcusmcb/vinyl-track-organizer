# Vinyl DJ Library — Project Plan and Technical Starting Guide

**Status:** Planning / proof of concept  
**Primary goal:** Validate a fast, reliable, self-managed Discogs catalog and track-level collection import before building the full web application.  
**Preferred stack:** Node.js, TypeScript, PostgreSQL, Next.js (later).  
**Product model:** Free-to-use, centrally hosted web application; desktop/Electron is a possible future option.

## 1. Product vision

Build a DJ-focused vinyl library application that turns a user's Discogs **release collection** into a searchable **individual-track library**. Users authenticate with Discogs, import their owned releases, browse tracks on those records, and assign each physical record to a user-defined storage location (for example, **Main Storage Wall**, **DJ Booth Crate**, or **Gig Bag**). Track results display a visual flag indicating where the underlying record is physically located.

The application is **not** intended to replace Discogs as the source of catalog metadata or record ownership. Its value is track-level discovery and physical record retrieval for DJs.

### MVP product scope

- Discogs account authorization and collection import.
- Individual track listing/search for owned releases.
- Basic release and track metadata: release ID, title, artists, track position, track title, duration when present, format and label where available.
- Single-level, user-defined physical storage locations.
- Assign locations to **owned record copies**, not tracks; tracks inherit the location of their owned copy.
- Support duplicate owned copies of the same release in different locations.
- Bulk location assignment and unassigned records.
- User-triggered collection resynchronization with preservation of user-created data.

### Out of scope for initial data proof of concept

UI polish, BPM/key analysis, Serato integration, playlists, advanced nested location hierarchies, marketplace/pricing data, and automatic music matching across different releases.

## 2. Core architectural decision

**Self-host the public Discogs catalog; use the official Discogs API only for authenticated user collection membership and synchronization.** Do not rely on a third-party hosted mirror or API.

Discogs provides monthly compressed XML catalog dumps, including a **Releases** dataset with tracklists. Prepare and index the catalog **before** users register. During onboarding, fetch a user's collection pages, extract owned release IDs, and join them against the locally stored catalog. Avoid one API request per release for tracklists.

```text
OFFLINE / MONTHLY CATALOG PIPELINE
Official Discogs Releases XML.gz
    -> checksum / provenance validation
    -> streaming gzip decompression
    -> streaming XML parser / normalizer
    -> PostgreSQL staging tables via COPY
    -> validation / indexes / publish catalog snapshot

USER COLLECTION FLOW
User signs into web app
    -> authorizes Discogs
    -> paginated Discogs collection API requests
    -> owned release IDs + collection instance IDs
    -> match against local PostgreSQL catalog
    -> track-level library becomes searchable
    -> user assigns physical storage locations
```

### Why this architecture

- A release and its tracklist are stored once and reused for all users.
- Initial collection imports need paginated collection requests rather than per-release tracklist requests.
- Search performance and catalog availability are under our control.
- Monthly catalog maintenance is decoupled from user onboarding.
- A public demo endpoint for an open-source mirror was unreachable during testing; third-party importer code may still be studied, but production must not depend on its hosted service.

## 3. Discogs API constraints and legal checkpoint

**Verify current official documentation and terms before implementation and again before public launch.** Prior planning referenced approximately **60 authenticated requests/minute** and **25 unauthenticated requests/minute**; these are planning assumptions, not a guaranteed per-user allocation. Inspect response headers, 429 behavior, and whether quotas are applied by IP, token, or another scope. Centralize request throttling for a multi-user hosted service.

- OAuth authorizes access but does **not** waive Discogs' API terms.
- Public catalog metadata/tracklists from the official dumps are described as **CC0**; confirm exact scope and attribution/provenance requirements.
- User collection membership, folders, conditions, notes, and wantlists are **restricted** under API terms. Do not assume indefinite storage or unrestricted reuse is permitted merely because a user authorizes access.
- The product is intended to be **free**, reducing concerns around paid API-integrated features but not removing other contractual obligations.
- Obtain written clarification from Discogs about persistent collection-instance IDs, ownership relationships, sync snapshots, deletion, retention, and any user-facing display freshness requirements before public launch.
- Avoid ingesting marketplace prices, protected images, or other restricted content into the public catalog pipeline.
- User-created location and DJ annotations should be logically separate from imported Discogs data, and users should be able to disconnect and delete their account data.

**Official starting points:**

- Catalog dumps: https://data.discogs.com/
- Discogs developer/API documentation: https://www.discogs.com/developers
- Discogs API terms: https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use

## 4. Technology choices

| Concern | Initial choice | Notes |
|---|---|---|
| Runtime | Node.js (current supported LTS) | Keep importer and web app in same ecosystem |
| Language | TypeScript | Strong schemas and shared types |
| XML | `saxes` or equivalent streaming SAX parser | Handle large documents without full DOM |
| Decompression | Node.js `zlib` streams | Process `.xml.gz` without full extraction |
| Database | PostgreSQL | Primary key and search indexes |
| DB driver | `pg` | Connection management |
| Bulk ingestion | `pg-copy-streams` / PostgreSQL `COPY` | Avoid per-row inserts |
| Local DB | Docker Compose | Reproducible development |
| Future web app | Next.js | Auth, UI, application API |
| Future workers | Dedicated background worker + durable queue | Do not run multi-hour imports in serverless functions |

Python is not necessary initially. Reconsider only if representative benchmarks demonstrate a material advantage for `lxml` or other tooling.

## 5. Suggested repository layout

```text
vinyl-library/
├── apps/
│   └── web/                       # Later: Next.js UI and app API
├── packages/
│   ├── discogs-importer/          # Download, parse, normalize, import
│   ├── catalog-db/                # Migrations, queries, schemas
│   └── shared-types/              # Shared domain models
├── fixtures/
│   └── discogs-releases-small.xml # Representative test fixture
├── scripts/                       # Operational scripts
├── docs/                          # Architecture, decisions, legal notes
├── docker-compose.yml
└── README.md
```

## 6. Initial catalog data model

Start minimal; revise after inspecting real Discogs XML. Suggested conceptual tables:

| Table | Important fields | Purpose |
|---|---|---|
| `catalog_imports` | id, source_file, source_date, checksum, status, counts, started_at, completed_at | Audit and validate imports |
| `releases` | discogs_release_id PK, title, year, main_artist_display, formats_json, labels_json, import_id | Release lookup |
| `tracks` | id, discogs_release_id FK, ordinal, position, title, duration_text, artists_json, type | Tracklist and display order |

Preserve raw track **position** (`A1`, `B2`, etc.), **ordinal ordering**, and Discogs tracklist **type** (e.g., track vs heading). Discogs data may include subtracks, missing durations, mixed artist credits, and unusual numbering. Do not assume every item is playable or that identical titles imply identical recordings. Preserve optional metadata without inventing values.

For full monthly replacement, plan for **versioned staging tables or a staging database**, validation, then atomic/controlled activation. Ensure foreign keys and user-created references survive catalog swaps; stable Discogs release IDs should be used for cross-dataset joins.

### Future user-specific tables (subject to terms review)

- `users`: application identity.
- `discogs_connections`: account identifier and encrypted authorization credentials.
- `owned_records`: user ID, Discogs release ID, Discogs collection **instance ID**, optional location ID, sync status. Preserve duplicate copies.
- `storage_locations`: ID, user ID, name, optional description/photo. **Single level only** for MVP.
- `track_annotations`: user-specific tags/notes keyed to an owned copy and track identity, with stable mapping rules for catalog refreshes.
- `collection_sync_runs`: state, timestamps, page counts, errors, reconciliation summary.

Do not persist restricted user collection fields until the permitted storage model is confirmed.

## 7. Importer implementation requirements

1. Download a specific monthly official Releases dump and record its URL, size, date, and checksum when published. Fail clearly on incomplete downloads.
2. Read the gzip stream through a streaming XML parser. Never load the full XML into memory.
3. Normalize one release at a time. Handle entities, Unicode, absent fields, track headings, and nested structures.
4. Write releases and tracks to staging using batched, backpressure-aware PostgreSQL `COPY` operations. Avoid unbounded queues.
5. Maintain import metrics: processed releases, tracks, malformed entries, elapsed time, throughput, peak memory, disk usage.
6. Validate foreign keys, counts, sample known releases, and representative edge cases before activation.
7. Support safe restart/retry strategy: an interrupted import must not corrupt the active catalog. A full restart into fresh staging is acceptable for MVP.
8. Make imports idempotent at the snapshot level; repeated imports must not duplicate releases or tracks.
9. Provide a simple query/API: given a Discogs release ID, return release metadata and its ordered tracklist.
10. Document resource requirements based on measurements rather than guessing database size or import duration.

## 8. Collection import and sync design (after catalog PoC)

- Use the official authenticated Discogs collection endpoints, requesting the maximum supported page size after verifying current documentation.
- Queue and rate-limit requests across all active users; honor server-provided rate-limit and retry headers.
- Match each returned release ID to the local catalog; report unmatched releases and missing tracklists.
- Progressively expose completed pages to the UI instead of waiting for the full import.
- Keep collection **instance IDs** distinct from release IDs; one user can own multiple copies.
- For resync, reconcile adds, removals, and changes; don't overwrite user-created crate assignments or notes.
- Do not infer that a single API page is an authoritative full snapshot. Only apply destructive reconciliation after a successful complete scan.
- If permitted, store the minimal state needed for sync; define retention, disconnect, and deletion semantics.
- Consider optional Discogs CSV import as a later fallback; validate identifier coverage and terms first.

**Illustrative request estimate:** 2,000 owned records at 100 entries/page = 20 collection-list requests, **plus** authentication, pagination overhead, retries, and any exceptional lookups. At a nominal 60 requests/minute, 20 requests represent roughly 20 seconds of sustained throughput, **not a guaranteed end-to-end import time**. Shared IP quotas and network latency may increase this. Track metadata lookup should be local.

## 9. Phased delivery plan

### Phase 0 — Documentation and source validation

- [ ] Confirm current Discogs dumps, download URLs, file formats, checksums, and applicable CC0 terms.
- [ ] Inspect a representative Releases XML sample and tracklist edge cases.
- [ ] Record current API pagination, rate-limit, and OAuth behavior from official docs.
- [ ] Document unresolved restricted collection data retention questions.

### Phase 1 — Small local importer proof of concept **(start here)**

- [ ] Initialize TypeScript workspace and Docker Compose PostgreSQL.
- [ ] Add migration scripts for `catalog_imports`, `releases`, and `tracks`.
- [ ] Build a tiny XML fixture with standard and unusual tracklists.
- [ ] Implement streaming parser and normalization with automated tests.
- [ ] Implement backpressure-aware bulk insert into staging.
- [ ] Add CLI commands to import a local XML or XML.gz file and query a release ID.
- [ ] Verify track ordering, Unicode, optional fields, and duplicate release handling.

**Exit criterion:** A release ID returns the expected ordered tracklist from local PostgreSQL with no Discogs API calls.

### Phase 2 — Full catalog benchmark

- [ ] Download and verify a current official Releases dump.
- [ ] Run full import; record duration, throughput, memory, disk, errors, and row counts.
- [ ] Add relevant indexes and measure representative release-ID lookup latency.
- [ ] Validate a sample of real vinyl releases and tracklist completeness.
- [ ] Test failed import/restart and catalog snapshot activation.

**Exit criterion:** The full catalog can be imported reliably and queried quickly, with measured operating costs.

### Phase 3 — Real collection integration

- [ ] Set up Discogs OAuth with secure token handling.
- [ ] Fetch a test user's paginated collection through a centralized rate limiter.
- [ ] Match collection release IDs to the local catalog.
- [ ] Measure import-to-first-results, full completion, API calls, match coverage, and missing tracklists.
- [ ] Test duplicates and repeated sync while preserving local annotations.
- [ ] Resolve collection-data retention questions before production use.

**Exit criterion:** A real collection becomes a usable track library without per-release tracklist API requests in the common case.

### Phase 4 — Web application MVP

- [ ] User account/login and Discogs connection.
- [ ] Track search and filtering, with release and track positions.
- [ ] Single-level storage locations and visual location flags.
- [ ] Bulk record-to-location assignment.
- [ ] User-triggered sync and clear import progress/error states.
- [ ] Privacy, data deletion, monitoring, and production deployment.

## 10. Risks and decisions to track

| Risk / open question | Mitigation |
|---|---|
| Discogs collection data retention restrictions | Seek written clarification; minimize persisted restricted data |
| Shared API rate limit across users | Central queue, adaptive throttling, retries |
| Incomplete or outdated monthly catalog | Missing-release report, refresh policy, optional permitted fallback |
| Large import resource consumption | Streaming, `COPY`, benchmark, dedicated worker |
| Monthly full-snapshot replacement | Staging, validation, controlled activation, stable identifiers |
| Tracklist complexity | Preserve order, positions, types, nested metadata; fixtures |
| Duplicate physical copies | Model collection instance separately from release |
| Broken third-party demo API | No dependency on public mirrors |
| Free product still incurs hosting costs | Measure disk/CPU/network and set sustainable operating limits |

## 11. Suggested first Copilot task

Use this prompt in VS Code Copilot Agent/Plan mode:

> Read `docs/vinyl-library-project-plan.md` in full. We are starting **Phase 1 only**: a local TypeScript/Node.js Discogs Releases XML importer backed by Docker Compose PostgreSQL. First inspect the workspace and propose a minimal implementation plan. Do not implement Discogs OAuth, the Next.js UI, storage locations, or production deployment yet. Create a streaming XML parser that preserves release IDs and ordered tracklists (including positions, headings, optional durations, and nested/subtrack cases), PostgreSQL migrations, a backpressure-aware bulk ingestion path, test fixtures, automated tests, and a CLI to import a fixture and query tracks by release ID. Avoid full-file buffering, per-row database inserts, and any reliance on third-party hosted Discogs mirrors. Verify the solution with local tests and document commands, assumptions, and results. Ask questions only where a decision materially blocks implementation.

## 12. Reference links

- Official Discogs data dumps: https://data.discogs.com/
- Official developer documentation: https://www.discogs.com/developers
- API Terms of Use: https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use
- Discogs Mirror API (reference code only, not a hosted dependency): https://github.com/abl030/discogs-api
- discogs-xml2db (reference code only): https://github.com/philipmat/discogs-xml2db

---

**Guiding principle:** Prove that the official Discogs Releases dump can be imported into a self-managed PostgreSQL catalog and joined to a user's collection efficiently. Keep the first iteration focused on data correctness, repeatable ingestion, and measurable performance.
