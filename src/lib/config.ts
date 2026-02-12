/**
 * Build the base URL for an album's static assets.
 * Album files are expected at /<albumName>/
 */
export function buildAlbumUrl(albumName: string): string {
	return `https://assets.gornostay25.dev/photos/${encodeURIComponent(albumName)}/`;
}
