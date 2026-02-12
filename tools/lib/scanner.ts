import { $, Glob } from 'bun';
import { stat } from 'node:fs/promises';
import { join, parse as parsePath } from 'node:path';
import exifr from 'exifr';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp', 'tiff', 'tif']);

const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'avi', 'mkv', 'm4v']);

export type AssetType = 'photo' | 'live' | 'video';

export interface ScannedAsset {
	type: AssetType;
	date: Date;
	imagePath: string | null;
	videoPath: string | null;
}

/**
 * Scan a directory for images and videos. Detect live photos by matching
 * filename stems (e.g. IMG_1234.HEIC + IMG_1234.MOV = one "live" asset).
 * Returns assets sorted by date ascending (oldest first).
 */
export async function scanAssets(sourceDir: string): Promise<ScannedAsset[]> {
	// Collect all files grouped by stem
	const stemMap = new Map<string, { images: string[]; videos: string[] }>();

	const allExtensions = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
	// Also include uppercase variants
	const pattern = `**/*.{${allExtensions.join(',')},${allExtensions.map((e) => e.toUpperCase()).join(',')}}`;
	const glob = new Glob(pattern);

	for await (const relativePath of glob.scan({ cwd: sourceDir, dot: false })) {
		const fullPath = join(sourceDir, relativePath);
		const { name: stem, ext } = parsePath(relativePath);
		const extLower = ext.slice(1).toLowerCase(); // remove leading dot

		if (!stemMap.has(stem)) {
			stemMap.set(stem, { images: [], videos: [] });
		}

		const group = stemMap.get(stem)!;
		if (IMAGE_EXTENSIONS.has(extLower)) {
			group.images.push(fullPath);
		} else if (VIDEO_EXTENSIONS.has(extLower)) {
			group.videos.push(fullPath);
		}
	}

	// Build assets from stems
	const assets: ScannedAsset[] = [];

	for (const [, group] of stemMap) {
		const hasImage = group.images.length > 0;
		const hasVideo = group.videos.length > 0;

		if (hasImage && hasVideo) {
			// Live photo: image + video pair
			const imagePath = group.images[0];
			const videoPath = group.videos[0];
			const date = await extractImageDate(imagePath);
			assets.push({ type: 'live', date, imagePath, videoPath });
		} else if (hasImage) {
			// Photo only -- each image is a separate asset
			for (const imagePath of group.images) {
				const date = await extractImageDate(imagePath);
				assets.push({ type: 'photo', date, imagePath, videoPath: null });
			}
		} else if (hasVideo) {
			// Video only -- each video is a separate asset
			for (const videoPath of group.videos) {
				const date = await extractVideoDate(videoPath);
				assets.push({ type: 'video', date, imagePath: null, videoPath });
			}
		}
	}

	assets.sort((a, b) => a.date.getTime() - b.date.getTime());
	return assets;
}

/**
 * Extract date from EXIF data, falling back to file mtime.
 */
async function extractImageDate(filePath: string): Promise<Date> {
	try {
		const exif = await exifr.parse(filePath, {
			pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate']
		});

		if (exif?.DateTimeOriginal) return new Date(exif.DateTimeOriginal);
		if (exif?.CreateDate) return new Date(exif.CreateDate);
		if (exif?.ModifyDate) return new Date(exif.ModifyDate);
	} catch {
		// EXIF parsing failed, fall back to mtime
	}

	const fileStat = await stat(filePath);
	return fileStat.mtime;
}

/**
 * Extract creation date from video via ffprobe, falling back to file mtime.
 */
async function extractVideoDate(filePath: string): Promise<Date> {
	try {
		const result =
			await $`ffprobe -v quiet -print_format json -show_entries format_tags=creation_time ${filePath}`.quiet();
		const json = JSON.parse(result.text());
		const creationTime = json?.format?.tags?.creation_time;
		if (creationTime) return new Date(creationTime);
	} catch {
		// ffprobe failed
	}

	const fileStat = await stat(filePath);
	return fileStat.mtime;
}
