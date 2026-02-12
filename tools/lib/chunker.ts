import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { encrypt } from './crypto';
import type { AssetType } from './scanner';

const MAX_CHUNK_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

export interface ChunkEntry {
	id: number;
	type: AssetType;
	date: string; // ISO date string
	thumbnail: Uint8Array;
	asset: Uint8Array | null; // null for video-only
	video: Uint8Array | null; // null for photo-only
}

export interface ChunkInfo {
	chunkId: number;
	thumbnailsFile: string;
	originalsFile: string;
	videosFile: string | null; // null if no videos in this chunk
	startIndex: number;
	endIndex: number;
}

/**
 * Helper: archive -> gzip -> encrypt -> write
 */
async function writeEncryptedArchive(
	files: Record<string, Uint8Array>,
	outputPath: string,
	tmpPath: string,
	key: CryptoKey
): Promise<void> {
	await Bun.write(tmpPath, new Bun.Archive(files));
	const tar = await Bun.file(tmpPath).bytes();
	const gzip = Bun.gzipSync(tar);
	await Bun.write(outputPath, await encrypt(key, gzip));
	await unlink(tmpPath);
}

/**
 * Create chunked, encrypted archives from converted assets.
 * Produces three files per chunk: thumbnails (with meta.json), originals, and videos.
 */
export async function createChunks(
	entries: ChunkEntry[],
	outputDir: string,
	encryptionKey: CryptoKey
): Promise<ChunkInfo[]> {
	const chunksDir = join(outputDir, 'chunks');
	await mkdir(chunksDir, { recursive: true });

	const chunks: ChunkInfo[] = [];
	let chunkId = 0;
	let chunkStartIndex = 0;
	let currentAssetSize = 0;

	let thumbFiles: Record<string, Uint8Array> = {};
	let assetFiles: Record<string, Uint8Array> = {};
	let videoFiles: Record<string, Uint8Array> = {};
	let metaEntries: Record<string, { date: string; type: AssetType }> = {};

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];

		// Thumbnail (always present)
		thumbFiles[`thumb${entry.id}.avif`] = entry.thumbnail;

		// Photo/live-photo original
		if (entry.asset) {
			assetFiles[`asset${entry.id}.avif`] = entry.asset;
			currentAssetSize += entry.asset.byteLength;
		}

		// Video (standalone or live-photo video part)
		if (entry.video) {
			videoFiles[`video${entry.id}.mp4`] = entry.video;
		}

		// Metadata
		metaEntries[String(entry.id)] = { date: entry.date, type: entry.type };

		const isLast = i === entries.length - 1;
		const chunkFull = currentAssetSize >= MAX_CHUNK_SIZE;

		if (chunkFull || isLast) {
			// Add meta.json to thumbnails archive
			thumbFiles['meta.json'] = new TextEncoder().encode(JSON.stringify(metaEntries));

			// Write thumbnails chunk
			const thumbnailsFile = `chunks/thumbs-${chunkId}.enc`;
			await writeEncryptedArchive(
				thumbFiles,
				join(outputDir, thumbnailsFile),
				join(chunksDir, `_tmp_thumbs_${chunkId}`),
				encryptionKey
			);

			// Write originals chunk
			const originalsFile = `chunks/originals-${chunkId}.enc`;
			await writeEncryptedArchive(
				assetFiles,
				join(outputDir, originalsFile),
				join(chunksDir, `_tmp_assets_${chunkId}`),
				encryptionKey
			);

			// Write videos chunk (only if there are videos)
			let videosFile: string | null = null;
			if (Object.keys(videoFiles).length > 0) {
				videosFile = `chunks/videos-${chunkId}.enc`;
				await writeEncryptedArchive(
					videoFiles,
					join(outputDir, videosFile),
					join(chunksDir, `_tmp_videos_${chunkId}`),
					encryptionKey
				);
			}

			chunks.push({
				chunkId,
				thumbnailsFile,
				originalsFile,
				videosFile,
				startIndex: chunkStartIndex,
				endIndex: entry.id
			});

			chunkId++;
			chunkStartIndex = entry.id + 1;
			currentAssetSize = 0;
			thumbFiles = {};
			assetFiles = {};
			videoFiles = {};
			metaEntries = {};
		}
	}

	return chunks;
}
