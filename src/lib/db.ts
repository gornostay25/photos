/**
 * Shared IndexedDB helper. Used by both the Web Worker and the store.
 */

import { openDB, type IDBPDatabase } from 'idb';

const DB_VERSION = 3;
const STORES = ['thumbnails', 'originals', 'videos', 'meta'] as const;

/** Cached DB connections keyed by album name. */
const cache = new Map<string, Promise<IDBPDatabase>>();

/**
 * Get (or create) an IndexedDB connection for the given album.
 * Connections are cached so repeated calls don't open new ones.
 */
export function getDb(albumName: string): Promise<IDBPDatabase> {
	let promise = cache.get(albumName);
	if (!promise) {
		promise = openDB(`album-${albumName}`, DB_VERSION, {
			upgrade(db) {
				for (const name of STORES) {
					if (!db.objectStoreNames.contains(name)) {
						db.createObjectStore(name);
					}
				}
			},
			blocking() {
				// Close this connection so pending deletes/upgrades can proceed
				promise?.then((db) => db.close());
				cache.delete(albumName);
			}
		});
		cache.set(albumName, promise);
	}
	return promise;
}

/**
 * Close and remove a cached DB connection.
 */
export async function closeDb(albumName: string): Promise<void> {
	const promise = cache.get(albumName);
	if (promise) {
		cache.delete(albumName);
		try {
			const db = await promise;
			db.close();
		} catch {
			/* ignore */
		}
	}
}
