import { $ } from 'bun';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { unlink, rename } from 'node:fs/promises';
import exifr from 'exifr';

// Quality settings
const IMAGE_CRF = 23;
const THUMB_CRF = 32;
const VIDEO_CRF = 28;
const THUMB_SIZE = 256;

// Extensions that need sips pre-decode (ffmpeg can't handle HEIC grid images)
const SIPS_EXTENSIONS = new Set(['.heic', '.heif']);

/**
 * Decode an image to a lossless PNG intermediate using macOS sips.
 * Required for HEIC files where ffmpeg only sees 512x512 grid tiles.
 * Also applies EXIF rotation to pixels using exifr + sips -r.
 * For non-HEIC formats, returns the original path (no conversion needed).
 */
async function decodeImage(
	sourcePath: string,
	id: number
): Promise<{ path: string; temp: boolean }> {
	const ext = extname(sourcePath).toLowerCase();
	if (!SIPS_EXTENSIONS.has(ext)) {
		return { path: sourcePath, temp: false };
	}

	// Read rotation from EXIF using exifr (sips -g orientation returns <nil> for HEIC)
	let rotateDeg = 0;
	try {
		const rotation = await exifr.rotation(sourcePath);
		if (rotation && rotation.deg) {
			rotateDeg = rotation.deg;
		}
	} catch {
		/* no rotation info available */
	}

	const tmp = tmpdir();
	const pngPath = join(tmp, `decoded_${id}.png`);

	// Decode HEIC to full-resolution PNG
	await $`sips -s format png ${sourcePath} --out ${pngPath}`.quiet();

	// Apply rotation to pixels (sips -s format png does NOT bake in orientation)
	if (rotateDeg !== 0) {
		await $`sips -r ${rotateDeg} ${pngPath}`.quiet();
	}

	return { path: pngPath, temp: true };
}

// ── Cache file naming helpers ────────────────────────────────────

export function thumbCacheName(id: number): string {
	return `${id}.thumb.avif`;
}
export function assetCacheName(id: number): string {
	return `${id}.asset.avif`;
}
export function videoCacheName(id: number): string {
	return `${id}.video.mp4`;
}

// ── Convert-to-directory variants (write to cache, no memory) ───

/**
 * Convert a photo to AVIF (full + thumbnail) and write to cacheDir.
 * Produces: <id>.thumb.avif, <id>.asset.avif
 */
export async function convertPhotoToDir(
	sourcePath: string,
	id: number,
	cacheDir: string
): Promise<void> {
	const tmp = tmpdir();
	const tmpImage = join(tmp, `photo_${id}.avif`);
	const tmpThumb = join(tmp, `thumb_${id}.avif`);
	const decoded = await decodeImage(sourcePath, id);

	try {
		await $`ffmpeg -y -autorotate -i ${decoded.path} -c:v libsvtav1 -crf ${IMAGE_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${tmpImage}`.quiet();
		await $`ffmpeg -y -autorotate -i ${decoded.path} -vf scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${tmpThumb}`.quiet();

		// Move to cache (atomic-ish: write to tmp first, then rename)
		await rename(tmpThumb, join(cacheDir, thumbCacheName(id)));
		await rename(tmpImage, join(cacheDir, assetCacheName(id)));
	} finally {
		await unlink(tmpImage).catch(() => {});
		await unlink(tmpThumb).catch(() => {});
		if (decoded.temp) await unlink(decoded.path).catch(() => {});
	}
}

/**
 * Convert a video to AV1 MP4 + AVIF thumbnail and write to cacheDir.
 * Produces: <id>.thumb.avif, <id>.video.mp4
 */
export async function convertVideoToDir(
	sourcePath: string,
	id: number,
	cacheDir: string
): Promise<void> {
	const tmp = tmpdir();
	const tmpVideo = join(tmp, `video_${id}.mp4`);
	const tmpThumb = join(tmp, `vthumb_${id}.avif`);

	try {
		await $`ffmpeg -y -i ${sourcePath} -c:v libsvtav1 -crf ${VIDEO_CRF} -preset 6 -pix_fmt yuv420p10le -c:a libopus -b:a 96k ${tmpVideo}`.quiet();
		await $`ffmpeg -y -i ${sourcePath} -vf thumbnail,scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -frames:v 1 -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le ${tmpThumb}`.quiet();

		await rename(tmpThumb, join(cacheDir, thumbCacheName(id)));
		await rename(tmpVideo, join(cacheDir, videoCacheName(id)));
	} finally {
		await unlink(tmpVideo).catch(() => {});
		await unlink(tmpThumb).catch(() => {});
	}
}

/**
 * Convert a live photo pair (image + video) and write to cacheDir.
 * Produces: <id>.thumb.avif, <id>.asset.avif, <id>.video.mp4
 */
export async function convertLivePhotoToDir(
	imageSrc: string,
	videoSrc: string,
	id: number,
	cacheDir: string
): Promise<void> {
	const tmp = tmpdir();
	const tmpImage = join(tmp, `live_img_${id}.avif`);
	const tmpThumb = join(tmp, `live_thumb_${id}.avif`);
	const tmpVideo = join(tmp, `live_vid_${id}.mp4`);
	const decoded = await decodeImage(imageSrc, id + 100000);

	try {
		await $`ffmpeg -y -autorotate -i ${decoded.path} -c:v libsvtav1 -crf ${IMAGE_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${tmpImage}`.quiet();
		await $`ffmpeg -y -autorotate -i ${decoded.path} -vf scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${tmpThumb}`.quiet();
		await $`ffmpeg -y -i ${videoSrc} -c:v libsvtav1 -crf ${VIDEO_CRF} -preset 6 -pix_fmt yuv420p10le -c:a libopus -b:a 96k ${tmpVideo}`.quiet();

		await rename(tmpThumb, join(cacheDir, thumbCacheName(id)));
		await rename(tmpImage, join(cacheDir, assetCacheName(id)));
		await rename(tmpVideo, join(cacheDir, videoCacheName(id)));
	} finally {
		await unlink(tmpImage).catch(() => {});
		await unlink(tmpThumb).catch(() => {});
		await unlink(tmpVideo).catch(() => {});
		if (decoded.temp) await unlink(decoded.path).catch(() => {});
	}
}
