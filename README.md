# Vinyl Track Organizer

A DJ-focused vinyl library application that turns a Discogs release collection into a searchable track-level library.

## Status

**Phase 1 — Local importer proof of concept** (in progress)

## Prerequisites

- Node.js 20+
- pnpm 10+
- Local PostgreSQL 16+ (no Docker required)

## Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Configure database connection
cp .env.example .env
# Edit .env with your local PostgreSQL credentials

# Run migrations
cd packages/discogs-importer
node dist/cli.js migrate

# Import the sample fixture (100 real Discogs releases)
node dist/cli.js import ../../../fixtures/discogs-releases-small.xml

# Query a release
node dist/cli.js query 1
```

## Project structure

```
vinyl-track-organizer/
├── packages/
│   ├── shared-types/       # Shared TypeScript domain models
│   ├── catalog-db/         # PostgreSQL schema, migrations, queries
│   └── discogs-importer/   # Streaming XML parser and bulk importer
├── fixtures/               # Test fixtures from real Discogs dumps
├── docs/                   # Project plan and architecture
└── apps/                   # Future: Next.js web application
```

## Documentation

- [Project plan and technical guide](docs/vinyl-library-project-plan.md)

---

Marcus McBride, 2026