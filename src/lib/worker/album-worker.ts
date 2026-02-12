import { gunzipSync } from 'fflate';
import type { Manifest, ChunkMeta, ChunkKind, WorkerRequest, WorkerResponse } from '$lib/types';
import { deriveKey, decrypt, sha256Hex } from '$lib/crypto';
import { getDb } from '$lib/db';

let cryptoKey: CryptoKey | null = null;
let currentAlbumName = '';

async function decryptData(data: Uint8Array): Promise<Uint8Array> {
	if (!cryptoKey) throw new Error('Worker not initialized');
	return decrypt(cryptoKey, data);
}

function parseTar(buffer: Uint8Array): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	let offset = 0;

	while (offset < buffer.length - 512) {
		const header = buffer.subarray(offset, offset + 512);
		if (header.every((b) => b === 0)) break;

		let name = '';
		for (let i = 0; i < 100 && header[i] !== 0; i++) {
			name += String.fromCharCode(header[i]);
		}

		let sizeStr = '';
		for (let i = 124; i < 136 && header[i] !== 0; i++) {
			sizeStr += String.fromCharCode(header[i]);
		}
		const size = parseInt(sizeStr.trim(), 8) || 0;

		offset += 512;

		if (size > 0 && name) {
			files.set(name, buffer.slice(offset, offset + size));
			offset += Math.ceil(size / 512) * 512;
		}
	}

	return files;
}

/** Extract numeric ID from filenames like thumb123.avif, asset123.avif, video123.mp4 */
function extractId(filename: string): number {
	const match = filename.match(/(\d+)\.\w+$/);
	return match ? parseInt(match[1], 10) : -1;
}

/** Determine MIME type from filename extension. */
function mimeType(filename: string): string {
	if (filename.endsWith('.avif')) return 'image/avif';
	if (filename.endsWith('.mp4')) return 'video/mp4';
	return 'application/octet-stream';
}

async function handleInit(albumName: string, password: string): Promise<WorkerResponse> {
	try {
		cryptoKey = await deriveKey(password, albumName);
		currentAlbumName = albumName;
		await getDb(albumName);
		return { type: 'init-ready' };
	} catch (err) {
		return { type: 'manifest-error', error: err instanceof Error ? err.message : String(err) };
	}
}

async function handleDecryptManifest(url: string): Promise<WorkerResponse> {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const encrypted = new Uint8Array(await res.arrayBuffer());
		const decrypted = await decryptData(encrypted);

		const manifestHash = await sha256Hex(decrypted);
		const manifest = JSON.parse(new TextDecoder().decode(decrypted)) as Manifest;

		return { type: 'manifest-decrypted', manifest, manifestHash };
	} catch (err) {
		return { type: 'manifest-error', error: err instanceof Error ? err.message : String(err) };
	}
}

async function handleFetchChunk(
	url: string,
	storeName: string,
	chunkId: number,
	kind: ChunkKind
): Promise<WorkerResponse> {
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const encrypted = new Uint8Array(await res.arrayBuffer());
		const decrypted = await decryptData(encrypted);

		const isGzip = decrypted.length >= 2 && decrypted[0] === 0x1f && decrypted[1] === 0x8b;
		const tarData = isGzip ? gunzipSync(decrypted) : decrypted;

		const files = parseTar(tarData);

		// Parse meta.json if present (only in thumbnail chunks)
		let meta: ChunkMeta | undefined;
		const metaFile = files.get('meta.json');
		if (metaFile) {
			try {
				meta = JSON.parse(new TextDecoder().decode(metaFile)) as ChunkMeta;
			} catch {
				/* ignore malformed meta */
			}
			files.delete('meta.json');
		}

		// Store all non-meta files in IDB
		const db = await getDb(currentAlbumName);
		const tx = db.transaction(storeName, 'readwrite');
		const store = tx.objectStore(storeName);
		const ids: number[] = [];

		for (const [filename, data] of files) {
			const id = extractId(filename);
			if (id >= 0) {
				const blob = new Blob([new Uint8Array(data)], { type: mimeType(filename) });
				await store.put(blob, id);
				ids.push(id);
			}
		}

		await tx.done;

		// Persist metadata to IDB so it survives across sessions
		if (meta) {
			const metaTx = db.transaction('meta', 'readwrite');
			const metaStore = metaTx.objectStore('meta');
			for (const [id, entry] of Object.entries(meta)) {
				await metaStore.put(entry, parseInt(id, 10));
			}
			await metaTx.done;
		}

		return { type: 'chunk-ready', kind, chunkId, ids, meta };
	} catch (err) {
		return {
			type: 'chunk-error',
			kind,
			chunkId,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
	const msg = e.data;
	let response: WorkerResponse;

	switch (msg.type) {
		case 'init':
			response = await handleInit(msg.albumName, msg.password);
			break;
		case 'decrypt-manifest':
			response = await handleDecryptManifest(msg.url);
			break;
		case 'fetch-thumbnails':
			response = await handleFetchChunk(msg.url, 'thumbnails', msg.chunkId, 'thumbnails');
			break;
		case 'fetch-originals':
			response = await handleFetchChunk(msg.url, 'originals', msg.chunkId, 'originals');
			break;
		case 'fetch-videos':
			response = await handleFetchChunk(msg.url, 'videos', msg.chunkId, 'videos');
			break;
		default:
			return;
	}

	self.postMessage(response);
};
