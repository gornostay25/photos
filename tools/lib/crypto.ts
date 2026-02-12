const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 12;

/**
 * Derive a deterministic salt from album name using SHA-256.
 * No separate salt file needed.
 */
export async function albumSalt(albumName: string): Promise<Uint8Array<ArrayBuffer>> {
	const data = new TextEncoder().encode(albumName);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return new Uint8Array(hash) as Uint8Array<ArrayBuffer>;
}

/**
 * Derive an AES-256-GCM key from password + album name using PBKDF2.
 * Salt is deterministically derived from album name via SHA-256.
 * Works in both Bun (CLI) and browser (Web Worker) via crypto.subtle.
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
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt data with AES-256-GCM.
 * Returns: [12 bytes IV][ciphertext with GCM auth tag]
 */
export async function encrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH)) as Uint8Array<ArrayBuffer>;
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		data as Uint8Array<ArrayBuffer>
	);

	const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	result.set(iv, 0);
	result.set(new Uint8Array(ciphertext), IV_LENGTH);
	return result;
}

/**
 * Decrypt data encrypted with encrypt().
 * Input: [12 bytes IV][ciphertext with GCM auth tag]
 */
export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const iv = data.slice(0, IV_LENGTH);
	const ciphertext = data.slice(IV_LENGTH);

	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

	return new Uint8Array(plaintext);
}
