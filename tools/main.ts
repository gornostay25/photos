/// <reference types="@types/bun" />

import { argv } from 'bun';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { scanAssets, type ScannedAsset } from './lib/scanner';
import { convertPhoto, convertVideo, convertLivePhoto } from './lib/converter';
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

console.log(`Source: ${resolvedSource}`);
console.log(`Album:  ${albumName}`);
console.log(`Output: ${albumDir}\n`);

// Step 1: Scan and sort by date
console.log('Scanning for assets...');
const scanned = await scanAssets(resolvedSource).then((assets) => {
	return assets.splice(0, 30);
});

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

// Step 2: Derive encryption key
console.log('\nDeriving encryption key...');
const key = await deriveKey(password, albumName);

// Step 3: Convert assets in parallel
const concurrency = jobs ?? availableParallelism();
console.log(`\nConverting assets (${concurrency} parallel jobs)...`);
await mkdir(albumDir, { recursive: true });

let done = 0;

const results = await mapParallel(scanned, concurrency, async (asset: ScannedAsset, i: number) => {
	const label = asset.imagePath ?? asset.videoPath ?? '?';

	let entry: ChunkEntry;

	if (asset.type === 'photo' && asset.imagePath) {
		const c = await convertPhoto(asset.imagePath, i);
		entry = {
			id: i,
			type: 'photo',
			date: asset.date.toISOString(),
			thumbnail: c.thumbnail,
			asset: c.image,
			video: null
		};
	} else if (asset.type === 'live' && asset.imagePath && asset.videoPath) {
		const c = await convertLivePhoto(asset.imagePath, asset.videoPath, i);
		entry = {
			id: i,
			type: 'live',
			date: asset.date.toISOString(),
			thumbnail: c.thumbnail,
			asset: c.image,
			video: c.video
		};
	} else if (asset.type === 'video' && asset.videoPath) {
		const c = await convertVideo(asset.videoPath, i);
		entry = {
			id: i,
			type: 'video',
			date: asset.date.toISOString(),
			thumbnail: c.thumbnail,
			asset: null,
			video: c.video
		};
	} else {
		throw new Error('unexpected asset configuration');
	}

	const n = ++done;
	console.log(`[${n}/${scanned.length}] ✓ [${asset.type}] ${label}`);
	return { entry, date: asset.date };
});

// Collect successful results, preserving original order by id
const entries: ChunkEntry[] = [];
const dates: Date[] = [];
let errors = 0;

for (let i = 0; i < results.length; i++) {
	const r = results[i];
	if (r instanceof Error) {
		const label = scanned[i].imagePath ?? scanned[i].videoPath ?? '?';
		console.error(`✗ ${label}: ${r.message}`);
		errors++;
	} else {
		entries.push(r.entry);
		dates.push(r.date);
	}
}

console.log(
	`\nConverted ${entries.length}/${scanned.length} assets${errors > 0 ? ` (${errors} failed)` : ''}`
);

// Step 4: Create encrypted chunks
console.log('\nCreating encrypted chunks...');
const chunks = await createChunks(entries, albumDir, key);
console.log(`Created ${chunks.length} chunk(s)`);

for (const chunk of chunks) {
	const videoTag = chunk.videosFile ? ' +videos' : '';
	console.log(`  Chunk ${chunk.chunkId}: assets ${chunk.startIndex}-${chunk.endIndex}${videoTag}`);
}

// Step 5: Generate and encrypt manifest
console.log('\nGenerating encrypted manifest...');
const manifest = generateManifest(dates, chunks);
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const encryptedManifest = await encrypt(key, manifestBytes);
await Bun.write(resolve(albumDir, 'manifest.enc'), encryptedManifest);

console.log(
	`\nDone! ${manifest.totalAssets} assets in ${chunks.length} chunk(s), ${manifest.months.length} month(s)`
);
console.log(`Output: ${albumDir}`);
