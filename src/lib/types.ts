export type AssetType = 'photo' | 'live' | 'video';

export interface ManifestChunk {
	chunkId: number;
	thumbnailsFile: string;
	originalsFile: string;
	videosFile: string | null;
	startIndex: number;
	endIndex: number;
}

export interface ManifestMonth {
	date: string;
	startId: number;
	count: number;
}

export interface Manifest {
	totalAssets: number;
	chunks: ManifestChunk[];
	months: ManifestMonth[];
}

export interface Asset {
	id: number;
	date: string;
	type: AssetType;
}

export interface AssetGroup {
	key: string;
	label: string;
	assets: Asset[];
}

/** Per-asset metadata parsed from meta.json inside thumbnail chunks. */
export type ChunkMeta = Record<string, { date: string; type: AssetType }>;

export type ChunkKind = 'thumbnails' | 'originals' | 'videos';

// Worker message types
export type WorkerRequest =
	| { type: 'init'; albumName: string; password: string }
	| { type: 'decrypt-manifest'; url: string }
	| { type: 'fetch-thumbnails'; chunkId: number; url: string }
	| { type: 'fetch-originals'; chunkId: number; url: string }
	| { type: 'fetch-videos'; chunkId: number; url: string };

export type WorkerResponse =
	| { type: 'init-ready' }
	| { type: 'manifest-decrypted'; manifest: Manifest; manifestHash: string }
	| { type: 'manifest-error'; error: string }
	| { type: 'chunk-ready'; kind: ChunkKind; chunkId: number; ids: number[]; meta?: ChunkMeta }
	| { type: 'chunk-error'; kind: ChunkKind; chunkId: number; error: string };
