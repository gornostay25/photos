/// <reference types="@types/bun" />

import { argv } from 'bun';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { scanAssets, type ScannedAsset } from './lib/scanner';
import {
	convertPhotoToDir,
	convertVideoToDir,
	convertLivePhotoToDir,
	thumbCacheName,
	assetCacheName,
	videoCacheName
} from './lib/converter';
import { createChunks, type ChunkEntry } from './lib/chunker';
import { generateManifest } from './lib/manifest';
import { deriveKey, encrypt } from './lib/crypto';

// ── Parallel helper ───────────────────────────────────────────────

async function mapParallel<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<(R | Error)[]> {
	const results: (R | Error)[] = new Array(items.length);
	let next = 0;

	async function worker() {
		while (next < items.length) {
			const i = next++;
			try {
				results[i] = await fn(items[i], i);
			} catch (err) {
				results[i] = err instanceof Error ? err : new Error(String(err));
			}
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return results;
}

// ── Progress persistence ──────────────────────────────────────────

interface ProgressFile {
	sources: string[]; // ordered source paths from scan
	completed: number[]; // asset IDs that are fully converted
}

async function loadProgress(progressPath: string): Promise<ProgressFile | null> {
	try {
		const raw = await readFile(progressPath, 'utf-8');
		return JSON.parse(raw) as ProgressFile;
	} catch {
		return null;
	}
}

async function saveProgress(progressPath: string, progress: ProgressFile): Promise<void> {
	await writeFile(progressPath, JSON.stringify(progress));
}

/**
 * Build the deterministic source key for each scanned asset.
 * Used to detect if the source directory changed since last run.
 */
function sourceKey(asset: ScannedAsset): string {
	if (asset.imagePath && asset.videoPath) return `${asset.imagePath}|${asset.videoPath}`;
	return asset.imagePath ?? asset.videoPath ?? '';
}

// ── Time formatting ───────────────────────────────────────────────

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return `${m}m ${rs}s`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	return `${h}h ${rm}m`;
}

// ── CLI argument parsing ──────────────────────────────────────────

const args = argv.slice(2);
let sourceDir: string | undefined;
let outputPath = './output';
let password: string | undefined;
let albumName: string | undefined;
let jobs: number | undefined;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--password' && args[i + 1]) {
		password = args[++i];
	} else if (args[i] === '--album' && args[i + 1]) {
		albumName = args[++i];
	} else if ((args[i] === '--jobs' || args[i] === '-j') && args[i + 1]) {
		jobs = parseInt(args[++i], 10);
	} else if (!sourceDir) {
		sourceDir = args[i];
	} else {
		outputPath = args[i];
	}
}

if (!sourceDir || !password || !albumName) {
	console.error(
		'Usage: bun run tools/main.ts <source_path> [output_path] --album <name> --password <password> [-j <jobs>]'
	);
	console.error('  source_path  - directory with assets (photos/videos)');
	console.error('  output_path  - output directory (default: ./output)');
	console.error('  --album      - album name (required, creates subdirectory)');
	console.error('  --password   - encryption password (required)');
	console.error('  -j, --jobs   - parallel conversion jobs (default: CPU count)');
	process.exit(1);
}

const resolvedSource = resolve(sourceDir);
const albumDir = resolve(join(outputPath, albumName));
const cacheDir = join(albumDir, '.cache');
const progressPath = join(albumDir, '.progress.json');

console.log(`Source: ${resolvedSource}`);
console.log(`Album:  ${albumName}`);
console.log(`Output: ${albumDir}\n`);

// Step 1: Scan and sort by date
console.log('Scanning for assets...');
const scanned = await scanAssets(resolvedSource);

const photoCount = scanned.filter((a) => a.type === 'photo').length;
const liveCount = scanned.filter((a) => a.type === 'live').length;
const videoCount = scanned.filter((a) => a.type === 'video').length;
console.log(
	`Found ${scanned.length} assets (${photoCount} photos, ${liveCount} live, ${videoCount} videos)`
);

if (scanned.length === 0) {
	console.log('No assets found. Exiting.');
	process.exit(0);
}

// Step 2: Check for existing progress (resume support)
await mkdir(cacheDir, { recursive: true });

const currentSources = scanned.map(sourceKey);
let progress = await loadProgress(progressPath);
let completedSet: Set<number>;

if (progress && JSON.stringify(progress.sources) === JSON.stringify(currentSources)) {
	completedSet = new Set(progress.completed);
	const remaining = scanned.length - completedSet.size;
	console.log(`\nResuming: ${completedSet.size} already converted, ${remaining} remaining`);
} else {
	if (progress) {
		console.log('\nSource files changed since last run — starting fresh');
		await rm(cacheDir, { recursive: true, force: true });
		await mkdir(cacheDir, { recursive: true });
	}
	completedSet = new Set();
	progress = { sources: currentSources, completed: [] };
	await saveProgress(progressPath, progress);
}

// Step 3: Derive encryption key
console.log('\nDeriving encryption key...');
const key = await deriveKey(password, albumName);

// Step 4: Convert assets in parallel (with resume skip)
const concurrency = jobs ?? availableParallelism();
const toConvert = scanned
	.map((asset, i) => ({ asset, id: i }))
	.filter(({ id }) => !completedSet.has(id));

console.log(`\nConverting ${toConvert.length} assets (${concurrency} parallel jobs)...`);

const startTime = performance.now();
let done = 0;
let convertErrors = 0;

// Mutex for progress file writes
let progressDirty = false;
let progressWriting = false;

async function flushProgress() {
	if (!progress) return;
	if (progressWriting) {
		progressDirty = true;
		return;
	}
	progressWriting = true;
	try {
		await saveProgress(progressPath, progress);
		while (progressDirty) {
			progressDirty = false;
			await saveProgress(progressPath, progress);
		}
	} finally {
		progressWriting = false;
	}
}

if (toConvert.length > 0) {
	await mapParallel(toConvert, concurrency, async ({ asset, id }) => {
		const label = asset.imagePath ?? asset.videoPath ?? '?';

		try {
			if (asset.type === 'photo' && asset.imagePath) {
				await convertPhotoToDir(asset.imagePath, id, cacheDir);
			} else if (asset.type === 'live' && asset.imagePath && asset.videoPath) {
				await convertLivePhotoToDir(asset.imagePath, asset.videoPath, id, cacheDir);
			} else if (asset.type === 'video' && asset.videoPath) {
				await convertVideoToDir(asset.videoPath, id, cacheDir);
			} else {
				throw new Error('unexpected asset configuration');
			}

			// Mark as completed
			completedSet.add(id);
			progress!.completed.push(id);
			flushProgress(); // fire-and-forget, batched

			const n = ++done;
			const elapsed = performance.now() - startTime;
			const avgMs = elapsed / n;
			const remaining = toConvert.length - n;
			const eta = formatDuration(avgMs * remaining);

			console.log(
				`[${completedSet.size}/${scanned.length}] ✓ [${asset.type}] ${label}  (ETA: ${eta})`
			);
		} catch (err) {
			convertErrors++;
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[${asset.type}] ✗ ${label}: ${msg}`);
			throw err;
		}
	});

	// Final flush
	await saveProgress(progressPath, progress);
}

const totalConverted = completedSet.size;
const elapsed = formatDuration(performance.now() - startTime);
console.log(
	`\nConversion done: ${totalConverted}/${scanned.length} assets in ${elapsed}` +
		(convertErrors > 0 ? ` (${convertErrors} failed)` : '')
);

// Step 5: Build chunk entries from cache
console.log('\nBuilding chunk entries from cache...');
const entries: ChunkEntry[] = [];
const dates: Date[] = [];

for (let i = 0; i < scanned.length; i++) {
	if (!completedSet.has(i)) continue; // skip failed conversions

	const asset = scanned[i];
	const thumbPath = join(cacheDir, thumbCacheName(i));
	const hasAsset = asset.type === 'photo' || asset.type === 'live';
	const hasVideo = asset.type === 'video' || asset.type === 'live';

	entries.push({
		id: i,
		type: asset.type,
		date: asset.date.toISOString(),
		thumbnailPath: thumbPath,
		assetPath: hasAsset ? join(cacheDir, assetCacheName(i)) : null,
		videoPath: hasVideo ? join(cacheDir, videoCacheName(i)) : null
	});
	dates.push(asset.date);
}

// Step 6: Create encrypted chunks (reads from cache lazily)
console.log('\nCreating encrypted chunks...');
const chunks = await createChunks(entries, albumDir, key);
console.log(`Created ${chunks.length} chunk(s)`);

for (const chunk of chunks) {
	const videoTag = chunk.videosFile ? ' +videos' : '';
	console.log(`  Chunk ${chunk.chunkId}: assets ${chunk.startIndex}-${chunk.endIndex}${videoTag}`);
}

// Step 7: Generate and encrypt manifest
console.log('\nGenerating encrypted manifest...');
const manifest = generateManifest(dates, chunks);
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const encryptedManifest = await encrypt(key, manifestBytes);
await Bun.write(resolve(albumDir, 'manifest.enc'), encryptedManifest);

// Step 8: Clean up cache
console.log('Cleaning up cache...');
await rm(cacheDir, { recursive: true, force: true });
await rm(progressPath, { force: true });

console.log(
	`\nDone! ${manifest.totalAssets} assets in ${chunks.length} chunk(s), ${manifest.months.length} month(s)`
);
console.log(`Output: ${albumDir}`);
