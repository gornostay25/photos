/**
 * Shared frontend crypto functions for Web Worker and store.
 * Uses Web Crypto API (works in both main thread and worker).
 */

const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 12;

/**
 * Derive a deterministic salt from album name using SHA-256.
 */
export async function albumSalt(albumName: string): Promise<Uint8Array<ArrayBuffer>> {
	const data = new TextEncoder().encode(albumName);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return new Uint8Array(hash) as Uint8Array<ArrayBuffer>;
}

/**
 * Derive an AES-256-GCM decryption key from password + album name using PBKDF2.
 */
export async function deriveKey(password: string, albumName: string): Promise<CryptoKey> {
	const salt = await albumSalt(albumName);

	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	);

	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt']
	);
}

/**
 * Decrypt AES-256-GCM encrypted data.
 * Input format: [12 bytes IV][ciphertext with GCM auth tag]
 */
export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const iv = data.slice(0, IV_LENGTH) as Uint8Array<ArrayBuffer>;
	const ciphertext = data.slice(IV_LENGTH) as Uint8Array<ArrayBuffer>;

	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
	return new Uint8Array(plaintext);
}

/**
 * Compute SHA-256 hex hash of data.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
