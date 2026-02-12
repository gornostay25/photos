import type {
	Manifest,
	ManifestChunk,
	AssetGroup,
	ChunkKind,
	ChunkMeta,
	WorkerRequest,
	WorkerResponse
} from '$lib/types';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import albumWorkerUrl from '$lib/worker/album-worker.ts?worker';
import { buildAlbumUrl } from '$lib/config';
import { getDb, closeDb } from '$lib/db';

const INIT_TIMEOUT_MS = 30_000;

const MONTH_NAMES = [
	'Січень',
	'Лютий',
	'Березень',
	'Квітень',
	'Травень',
	'Червень',
	'Липень',
	'Серпень',
	'Вересень',
	'Жовтень',
	'Листопад',
	'Грудень'
] as const;

export class AlbumStore {
	manifest: Manifest | null = $state(null);
	groups: AssetGroup[] = $state([]);
	loading = $state(true);
	error: string | null = $state(null);
	albumName = $state('');

	private worker: Worker | null = null;
	private baseUrl = '';
	private pendingChunks = new SvelteMap<string, (() => void)[]>();
	private loadedChunks = new SvelteSet<string>();

	/**
	 * Initialize the album: spawn worker, derive key, decrypt manifest.
	 */
	async init(albumName: string, password: string): Promise<boolean> {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		this.pendingChunks.clear();
		this.loadedChunks.clear();

		this.albumName = albumName;
		this.loading = true;
		this.error = null;
		this.baseUrl = buildAlbumUrl(albumName);

		const worker = new albumWorkerUrl();
		this.worker = worker;

		return new Promise<boolean>((resolve) => {
			let settled = false;
			const settle = (result: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(result);
			};

			const timer = setTimeout(() => {
				this.error = 'Connection timeout';
				this.loading = false;
				worker.terminate();
				if (this.worker === worker) this.worker = null;
				settle(false);
			}, INIT_TIMEOUT_MS);

			worker.onerror = (ev) => {
				this.error = ev.message || 'Worker error';
				this.loading = false;
				worker.terminate();
				if (this.worker === worker) this.worker = null;
				settle(false);
			};

			worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
				const msg = e.data;

				if (msg.type === 'init-ready') {
					worker.postMessage({
						type: 'decrypt-manifest',
						url: this.baseUrl + 'manifest.enc'
					});
					return;
				}

				if (msg.type === 'manifest-decrypted') {
					this.manifest = msg.manifest;
					this.groups = this.buildGroups(msg.manifest);
					this.validateCache(msg.manifestHash);
					this.loadMetaFromDb(); // apply cached metadata (dates, types)
					this.loading = false;
					worker.onmessage = this.handleChunkMessage.bind(this);
					settle(true);
					return;
				}

				if (msg.type === 'manifest-error') {
					this.error = msg.error;
					this.loading = false;
					worker.terminate();
					if (this.worker === worker) this.worker = null;
					settle(false);
					return;
				}
			};

			worker.postMessage({ type: 'init', albumName, password });
		});
	}

	private buildGroups(manifest: Manifest): AssetGroup[] {
		return manifest.months
			.slice()
			.reverse()
			.map((month) => {
				const [yearStr, monthStr] = month.date.split('-');
				const yearNum = parseInt(yearStr, 10);
				const monthIdx = parseInt(monthStr, 10) - 1;
				const key = `${yearNum}-${String(monthIdx).padStart(2, '0')}`;
				const label = `${MONTH_NAMES[monthIdx]} ${yearNum}`;
				const assets = Array.from({ length: month.count }, (_, i) => ({
					id: month.startId + i,
					date: month.date,
					type: 'photo' as const // default, updated when thumbnail chunk loads
				}));
				return { key, label, assets };
			});
	}

	/**
	 * Apply real per-asset metadata from a thumbnail chunk's meta.json.
	 * Updates dates and types in existing groups reactively.
	 */
	private applyMeta(meta: ChunkMeta) {
		for (const group of this.groups) {
			for (let i = 0; i < group.assets.length; i++) {
				const asset = group.assets[i];
				const m = meta[String(asset.id)];
				if (m) {
					group.assets[i] = { ...asset, date: m.date, type: m.type };
				}
			}
		}
		// Trigger Svelte reactivity by creating a new array reference
		this.groups = [...this.groups];
	}

	/**
	 * Load persisted metadata from IDB and apply to assets.
	 * Covers the case where thumbnail chunks are cached and meta.json
	 * is not re-parsed from the network.
	 */
	private async loadMetaFromDb() {
		try {
			const db = await getDb(this.albumName);
			const tx = db.transaction('meta', 'readonly');
			const store = tx.objectStore('meta');
			const allKeys = await store.getAllKeys();
			const allValues = await store.getAll();
			const meta: ChunkMeta = {};
			for (let i = 0; i < allKeys.length; i++) {
				meta[String(allKeys[i])] = allValues[i];
			}
			if (Object.keys(meta).length > 0) {
				this.applyMeta(meta);
			}
		} catch {
			/* IDB may not have meta store yet on first load */
		}
	}

	private validateCache(newHash: string) {
		const hashKey = `manifest-hash:${this.albumName}`;
		const storedHash = localStorage.getItem(hashKey);
		localStorage.setItem(hashKey, newHash);

		if (storedHash !== null && storedHash !== newHash) {
			AlbumStore.clearCache(this.albumName);
		}
	}

	// ── Chunk management ──────────────────────────────────────────────

	private handleChunkMessage(e: MessageEvent<WorkerResponse>) {
		const msg = e.data;
		if (msg.type !== 'chunk-ready' && msg.type !== 'chunk-error') return;

		if (msg.type === 'chunk-error') {
			console.error(`Chunk error: ${msg.kind}-${msg.chunkId}: ${msg.error}`);
		}

		const chunkKey = `${msg.kind}-${msg.chunkId}`;
		if (msg.type === 'chunk-ready') {
			this.loadedChunks.add(chunkKey);

			// Apply metadata from thumbnail chunks
			if (msg.meta && msg.kind === 'thumbnails') {
				this.applyMeta(msg.meta);
			}
		}

		const pending = this.pendingChunks.get(chunkKey);
		if (pending) {
			pending.forEach((r) => r());
			this.pendingChunks.delete(chunkKey);
		}
	}

	private requestChunk(kind: ChunkKind, chunkId: number) {
		if (!this.manifest || !this.worker) return;
		const chunk = this.manifest.chunks[chunkId];
		if (!chunk) return;

		const chunkKey = `${kind}-${chunkId}`;
		if (this.loadedChunks.has(chunkKey) || this.pendingChunks.has(chunkKey)) return;

		let file: string | null;
		if (kind === 'thumbnails') file = chunk.thumbnailsFile;
		else if (kind === 'originals') file = chunk.originalsFile;
		else file = chunk.videosFile;

		if (!file) return; // e.g. no videos in this chunk

		this.pendingChunks.set(chunkKey, []);
		this.worker.postMessage({
			type: `fetch-${kind}` as WorkerRequest['type'],
			chunkId,
			url: this.baseUrl + file
		} satisfies { type: string; chunkId: number; url: string });
	}

	private findChunkForId(id: number): ManifestChunk | undefined {
		return this.manifest?.chunks.find((c) => id >= c.startIndex && id <= c.endIndex);
	}

	private waitForChunk(chunkKey: string): Promise<void> {
		if (this.loadedChunks.has(chunkKey)) return Promise.resolve();

		return new Promise<void>((resolve) => {
			const pending = this.pendingChunks.get(chunkKey);
			if (pending) {
				pending.push(resolve);
			} else {
				resolve();
			}
		});
	}

	// ── Public API -- returns Blobs, components manage URLs ───────────

	async getThumbnailBlob(id: number): Promise<Blob | null> {
		return this.getAssetBlob('thumbnails', id);
	}

	async getOriginalBlob(id: number): Promise<Blob | null> {
		return this.getAssetBlob('originals', id);
	}

	async getVideoBlob(id: number): Promise<Blob | null> {
		return this.getAssetBlob('videos', id);
	}

	private async getAssetBlob(kind: ChunkKind, id: number): Promise<Blob | null> {
		const db = await getDb(this.albumName);
		const existing = await db.get(kind, id);
		if (existing) return existing as Blob;

		const chunk = this.findChunkForId(id);
		if (!chunk) return null;

		this.requestChunk(kind, chunk.chunkId);
		await this.waitForChunk(`${kind}-${chunk.chunkId}`);

		const blob = await db.get(kind, id);
		return (blob as Blob) ?? null;
	}

	// ── Static helpers ────────────────────────────────────────────────

	static clearCache(albumName: string) {
		closeDb(albumName);
		indexedDB.deleteDatabase(`album-${albumName}`);
	}

	static saveRecentAlbum(albumName: string) {
		const key = 'recent-albums';
		let list: string[] = [];
		try {
			list = JSON.parse(localStorage.getItem(key) ?? '[]');
		} catch {
			/* ignore */
		}
		list = [albumName, ...list.filter((n) => n !== albumName)].slice(0, 10);
		localStorage.setItem(key, JSON.stringify(list));
	}

	static getRecentAlbums(): string[] {
		try {
			return JSON.parse(localStorage.getItem('recent-albums') ?? '[]');
		} catch {
			return [];
		}
	}

	destroy() {
		this.worker?.terminate();
		this.worker = null;
	}
}
