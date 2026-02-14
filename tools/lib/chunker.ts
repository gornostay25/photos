import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { encrypt } from './crypto';
import type { AssetType } from './scanner';

const MAX_CHUNK_SIZE = 500 * 1024 * 1024; // 500MB per chunk (tar+gzip+encrypt needs ~3-4x in RAM)

/**
 * A chunk entry referencing files on disk (not in-memory buffers).
 * This allows processing large collections without OOM.
 */
export interface ChunkEntry {
	id: number;
	type: AssetType;
	date: string; // ISO date string
	thumbnailPath: string;
	assetPath: string | null; // null for video-only
	videoPath: string | null; // null for photo-only
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
 * Create chunked, encrypted archives from converted assets on disk.
 * Reads files lazily per chunk to keep memory usage bounded.
 * Produces three files per chunk: thumbnails (with meta.json), originals, and videos.
 */
export async function createChunks(
	entries: ChunkEntry[],
	outputDir: string,
	encryptionKey: CryptoKey
): Promise<ChunkInfo[]> {
	const chunks: ChunkInfo[] = [];
	let chunkId = 0;
	let chunkStartIndex = 0;
	let currentAssetSize = 0;

	// Accumulate paths for the current chunk, read them only when flushing
	let chunkEntries: ChunkEntry[] = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		chunkEntries.push(entry);

		// Count ALL file sizes toward chunk budget (assets + videos)
		if (entry.assetPath) {
			currentAssetSize += Bun.file(entry.assetPath).size;
		}
		if (entry.videoPath) {
			currentAssetSize += Bun.file(entry.videoPath).size;
		}

		const isLast = i === entries.length - 1;
		const chunkFull = currentAssetSize >= MAX_CHUNK_SIZE;

		if (chunkFull || isLast) {
			// Read files for this chunk into memory, build tar, write, then release
			const thumbFiles: Record<string, Uint8Array> = {};
			const assetFiles: Record<string, Uint8Array> = {};
			const videoFiles: Record<string, Uint8Array> = {};
			const metaEntries: Record<string, { date: string; type: AssetType }> = {};

			for (const e of chunkEntries) {
				thumbFiles[`thumb${e.id}.avif`] = await Bun.file(e.thumbnailPath).bytes();

				if (e.assetPath) {
					assetFiles[`asset${e.id}.avif`] = await Bun.file(e.assetPath).bytes();
				}

				if (e.videoPath) {
					videoFiles[`video${e.id}.mp4`] = await Bun.file(e.videoPath).bytes();
				}

				metaEntries[String(e.id)] = { date: e.date, type: e.type };
			}

			// Add meta.json to thumbnails archive
			thumbFiles['meta.json'] = new TextEncoder().encode(JSON.stringify(metaEntries));

			// Write thumbnails chunk
			const thumbnailsFile = `thumbs-${chunkId}.enc`;
			await writeEncryptedArchive(
				thumbFiles,
				join(outputDir, thumbnailsFile),
				join(outputDir, `_tmp_thumbs_${chunkId}`),
				encryptionKey
			);

			// Write originals chunk
			const originalsFile = `originals-${chunkId}.enc`;
			await writeEncryptedArchive(
				assetFiles,
				join(outputDir, originalsFile),
				join(outputDir, `_tmp_assets_${chunkId}`),
				encryptionKey
			);

			// Write videos chunk (only if there are videos)
			let videosFile: string | null = null;
			if (Object.keys(videoFiles).length > 0) {
				videosFile = `videos-${chunkId}.enc`;
				await writeEncryptedArchive(
					videoFiles,
					join(outputDir, videosFile),
					join(outputDir, `_tmp_videos_${chunkId}`),
					encryptionKey
				);
			}

			chunks.push({
				chunkId,
				thumbnailsFile,
				originalsFile,
				videosFile,
				startIndex: chunkStartIndex,
				endIndex: chunkEntries[chunkEntries.length - 1].id
			});

			chunkId++;
			chunkStartIndex = chunkEntries[chunkEntries.length - 1].id + 1;
			currentAssetSize = 0;
			chunkEntries = [];
		}
	}

	return chunks;
}
