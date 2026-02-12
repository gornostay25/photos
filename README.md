# G25 Photos

Private, encrypted photo and video gallery. Fully client-side — no server logic, no accounts, no tracking. A CLI tool processes raw assets into encrypted chunked archives; a static SvelteKit frontend decrypts and displays them in the browser.

## Features

- **End-to-end encryption** — AES-256-GCM with PBKDF2-derived keys (100 000 iterations, deterministic salt from album name)
- **Photo, video, and live photo support** — photos converted to AVIF, videos to AV1 (MP4), live photos displayed as still image with on-demand video playback
- **Instagram-like grid** — responsive 3-column layout with monthly grouping and sticky date headers
- **Lazy-loading thumbnails** — skeleton placeholders, IntersectionObserver-based loading, first chunk prefetched immediately
- **Chunked archives** — assets bundled into gzipped tar archives under 2 GB each for efficient delivery
- **Web Worker offloading** — all heavy work (fetching, decryption, decompression, tar parsing, IndexedDB storage) runs off the main thread
- **Multi-album support** — each album gets its own IndexedDB database with manifest-hash-based cache validation
- **Autologin** — via URL hash (`#album:password`) or session persistence (sessionStorage)
- **Recent albums** — quick access to previously opened album names from the login screen
- **Download assets** — download the currently viewed photo or video from the preview modal
- **Static deployment** — builds to plain HTML/CSS/JS, serve from any static host

## Tech Stack

| Layer            | Technology                                    |
| ---------------- | --------------------------------------------- |
| Framework        | Svelte 5, SvelteKit 2, Vite 7                 |
| Styling          | Tailwind CSS v4                               |
| Runtime (CLI)    | Bun                                           |
| Media processing | ffmpeg, ffprobe                               |
| EXIF extraction  | exifr                                         |
| Encryption       | Web Crypto API (AES-256-GCM, PBKDF2, SHA-256) |
| Compression      | fflate (gunzip), Bun.gzipSync (gzip)          |
| Archiving        | Bun.Archive (tar)                             |
| Client storage   | IndexedDB via idb                             |
| Concurrency      | Web Workers                                   |

## Architecture

```
Raw assets (HEIC, JPG, MOV, MP4, ...)
        │
        ▼
┌──────────────────┐
│   CLI Tool (Bun)  │  scan → convert (AVIF/AV1) → chunk → encrypt → write
└──────────────────┘
        │
        ▼
  Static files:  <album>/manifest.enc
                 <album>/thumbnails-N.enc
                 <album>/originals-N.enc
                 <album>/videos-N.enc  (if applicable)
        │
        ▼
┌──────────────────┐
│  SvelteKit App    │  login → derive key → decrypt manifest → lazy-load chunks
│  (static build)   │  Web Worker: fetch → decrypt → gunzip → untar → IndexedDB
└──────────────────┘
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [ffmpeg](https://ffmpeg.org/) and `ffprobe` in PATH (for asset conversion)

### Install

```sh
bun install
```

### Development

```sh
bun run dev
```

## CLI — Processing Assets

The CLI tool scans a source directory, converts assets to web-friendly formats, bundles them into encrypted chunks, and outputs everything to a static directory.

```sh
bun run build:photos <source_path> [output_path] --album <name> --password <password> [-j <jobs>]
```

| Argument            | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `source_path`       | Directory containing raw photos and videos                   |
| `output_path`       | Output directory (default: `./output`)                       |
| `--album <name>`    | Album name — creates a subdirectory, used as encryption salt |
| `--password <pass>` | Encryption password                                          |
| `-j, --jobs <n>`    | Parallel conversion jobs (default: CPU core count)           |

### What it does

1. **Scan** — finds images and videos, extracts dates (EXIF / ffprobe), detects live photos by matching filename stems
2. **Sort** — orders assets chronologically (oldest first)
3. **Convert** — photos → AVIF (thumbnail + original), videos → AV1 MP4 + AVIF thumbnail, with auto-rotation
4. **Chunk** — groups assets into tar.gz archives under 2 GB, includes `meta.json` with per-asset date and type
5. **Encrypt** — AES-256-GCM encryption of every chunk and the manifest
6. **Output** — writes `manifest.enc`, `thumbnails-N.enc`, `originals-N.enc`, and `videos-N.enc` files

### Example

```sh
bun run build:photos ~/Photos/vacation ./static/gallery --album vacation-2025 --password "s3cret" -j 8
```

This creates `./static/gallery/vacation-2025/` with all encrypted files ready to serve.

## Building and Deploying

```sh
bun run build
```

This produces a static build in `build/`. Deploy the contents of `build/` along with `static/gallery/` to any static hosting (Nginx, Caddy, S3, Cloudflare Pages, etc.).

### Access

- **Login form** — enter album name and password
- **URL hash** — navigate to `https://your-domain/#album-name:password` for autologin
- **Session** — credentials persist in sessionStorage for the browser session

## How It Works

### Encryption

- **Key derivation**: PBKDF2 with SHA-256 (100 000 iterations). The salt is the SHA-256 hash of the album name — no separate salt file needed.
- **Encryption**: AES-256-GCM. Each encrypted file is formatted as `[12-byte IV][ciphertext + auth tag]`.
- **Manifest validation**: SHA-256 hash of the decrypted manifest is stored in localStorage. On subsequent loads, a hash mismatch triggers cache invalidation.

### Chunk Structure

Each thumbnail chunk (`.enc`) contains a gzipped tar archive with:

- `thumb0.avif`, `thumb1.avif`, ... — thumbnail images
- `meta.json` — per-asset metadata (`{ "0": { "date": "...", "type": "photo" }, ... }`)

Original and video chunks contain `asset0.avif`, `video0.mp4`, etc.

### Client-Side Flow

1. User enters album name + password (or autologin via hash)
2. Web Worker derives the encryption key via PBKDF2
3. Manifest is fetched, decrypted, and parsed — reveals chunk layout and monthly grouping
4. Thumbnail chunks are lazily fetched as the user scrolls (first chunk is prefetched)
5. Each chunk is decrypted → gunzipped → untarred → stored in IndexedDB
6. When a user opens an asset, the corresponding original/video chunk is fetched on demand

## Project Structure

```
├── src/
│   ├── lib/
│   │   ├── components/        # Svelte UI components
│   │   │   ├── AssetCard.svelte      # Single thumbnail with lazy loading
│   │   │   ├── AssetGrid.svelte      # Responsive grid with month sections
│   │   │   ├── AssetPreview.svelte   # Full-size preview modal (photo/video/live)
│   │   │   ├── AssetSkeleton.svelte  # Loading placeholder
│   │   │   ├── DateNav.svelte        # Horizontal month navigation
│   │   │   └── LoginForm.svelte      # Album + password login form
│   │   ├── stores/
│   │   │   └── album-store.svelte.ts # Reactive album state + worker orchestration
│   │   ├── worker/
│   │   │   └── album-worker.ts       # Web Worker (decrypt, decompress, parse, cache)
│   │   ├── config.ts                 # Album URL builder
│   │   ├── crypto.ts                 # Frontend crypto (PBKDF2, AES-GCM, SHA-256)
│   │   ├── db.ts                     # IndexedDB helper with connection caching
│   │   ├── types.ts                  # TypeScript interfaces
│   │   └── utils.ts                  # Date formatting helpers
│   └── routes/
│       ├── +layout.svelte            # Auth gate, autologin, context provider
│       └── +page.svelte              # Gallery page with grid + preview
├── tools/
│   ├── lib/
│   │   ├── scanner.ts                # Asset discovery + EXIF/ffprobe date extraction
│   │   ├── converter.ts              # ffmpeg conversion (AVIF, AV1, thumbnails)
│   │   ├── chunker.ts                # Tar + gzip + encrypt into chunks
│   │   ├── manifest.ts               # Manifest JSON generation
│   │   └── crypto.ts                 # CLI-side crypto (PBKDF2, AES-GCM)
│   └── main.ts                       # CLI entry point
├── static/gallery/                   # Encrypted album data (gitignored)
└── build/                            # Static build output (gitignored)
```

## Scripts

| Script                 | Description                   |
| ---------------------- | ----------------------------- |
| `bun run dev`          | Start development server      |
| `bun run build`        | Build static site             |
| `bun run preview`      | Preview production build      |
| `bun run build:photos` | Run CLI asset processing tool |
| `bun run check`        | Type-check with svelte-check  |
| `bun run lint`         | Lint with Prettier + ESLint   |
| `bun run format`       | Auto-format with Prettier     |

## License

Private project.
