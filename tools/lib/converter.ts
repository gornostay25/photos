import { $ } from 'bun';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

export interface ConvertedPhoto {
	image: Uint8Array;
	thumbnail: Uint8Array;
}

export interface ConvertedVideo {
	video: Uint8Array;
	thumbnail: Uint8Array;
}

export interface ConvertedLivePhoto {
	image: Uint8Array;
	video: Uint8Array;
	thumbnail: Uint8Array;
}

// Quality settings
const IMAGE_CRF = 23;
const THUMB_CRF = 32;
const VIDEO_CRF = 28;
const THUMB_SIZE = 256;

/**
 * Convert a source image to AVIF (full + thumbnail) using ffmpeg.
 */
export async function convertPhoto(sourcePath: string, id: number): Promise<ConvertedPhoto> {
	const tmp = tmpdir();
	const imagePath = join(tmp, `photo_${id}.avif`);
	const thumbPath = join(tmp, `thumb_${id}.avif`);

	try {
		await $`ffmpeg -y -autorotate -i ${sourcePath} -c:v libsvtav1 -crf ${IMAGE_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${imagePath}`.quiet();
		await $`ffmpeg -y -autorotate -i ${sourcePath} -vf scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${thumbPath}`.quiet();

		const image = await Bun.file(imagePath).bytes();
		const thumbnail = await Bun.file(thumbPath).bytes();
		return { image, thumbnail };
	} finally {
		await unlink(imagePath).catch(() => {});
		await unlink(thumbPath).catch(() => {});
	}
}

/**
 * Convert a video to AV1 MP4 + generate AVIF thumbnail from a frame.
 */
export async function convertVideo(sourcePath: string, id: number): Promise<ConvertedVideo> {
	const tmp = tmpdir();
	const videoPath = join(tmp, `video_${id}.mp4`);
	const thumbPath = join(tmp, `vthumb_${id}.avif`);

	try {
		// Encode video to AV1 MP4 with Opus audio
		await $`ffmpeg -y -i ${sourcePath} -c:v libsvtav1 -crf ${VIDEO_CRF} -preset 6 -pix_fmt yuv420p10le -c:a libopus -b:a 96k ${videoPath}`.quiet();

		// Generate thumbnail from a representative frame
		await $`ffmpeg -y -i ${sourcePath} -vf thumbnail,scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -frames:v 1 -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le ${thumbPath}`.quiet();

		const video = await Bun.file(videoPath).bytes();
		const thumbnail = await Bun.file(thumbPath).bytes();
		return { video, thumbnail };
	} finally {
		await unlink(videoPath).catch(() => {});
		await unlink(thumbPath).catch(() => {});
	}
}

/**
 * Convert a live photo pair (image + video) to AVIF still + AV1 MP4 video.
 * Thumbnail is generated from the still image.
 */
export async function convertLivePhoto(
	imageSrc: string,
	videoSrc: string,
	id: number
): Promise<ConvertedLivePhoto> {
	const tmp = tmpdir();
	const imagePath = join(tmp, `live_img_${id}.avif`);
	const thumbPath = join(tmp, `live_thumb_${id}.avif`);
	const videoPath = join(tmp, `live_vid_${id}.mp4`);

	try {
		// Still image
		await $`ffmpeg -y -autorotate -i ${imageSrc} -c:v libsvtav1 -crf ${IMAGE_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${imagePath}`.quiet();

		// Thumbnail from still image
		await $`ffmpeg -y -autorotate -i ${imageSrc} -vf scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease -c:v libsvtav1 -crf ${THUMB_CRF} -preset 6 -pix_fmt yuv420p10le -frames:v 1 ${thumbPath}`.quiet();

		// Video part to AV1 MP4
		await $`ffmpeg -y -i ${videoSrc} -c:v libsvtav1 -crf ${VIDEO_CRF} -preset 6 -pix_fmt yuv420p10le -c:a libopus -b:a 96k ${videoPath}`.quiet();

		const image = await Bun.file(imagePath).bytes();
		const thumbnail = await Bun.file(thumbPath).bytes();
		const video = await Bun.file(videoPath).bytes();
		return { image, video, thumbnail };
	} finally {
		await unlink(imagePath).catch(() => {});
		await unlink(thumbPath).catch(() => {});
		await unlink(videoPath).catch(() => {});
	}
}
