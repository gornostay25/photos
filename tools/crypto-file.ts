/// <reference types="@types/bun" />

/**
 * Encrypt or decrypt a single file using album-based AES-256-GCM encryption.
 *
 * Usage:
 *   bun run tools/crypto-file.ts encrypt <input> <output> --album <name> --password <pass>
 *   bun run tools/crypto-file.ts decrypt <input> <output> --album <name> --password <pass>
 */

import { argv } from 'bun';
import { deriveKey, encrypt, decrypt } from './lib/crypto';

const args = argv.slice(2);

let mode: 'encrypt' | 'decrypt' | undefined;
// let inputPath: string | undefined;
// let outputPath: string | undefined;
let albumName: string | undefined;
let password: string | undefined;

// First positional arg is the mode
if (args[0] === 'encrypt' || args[0] === 'decrypt') {
	mode = args[0];
}

const rest = args.slice(1);
const positional: string[] = [];

for (let i = 0; i < rest.length; i++) {
	if (rest[i] === '--album' && rest[i + 1]) {
		albumName = rest[++i];
	} else if (rest[i] === '--password' && rest[i + 1]) {
		password = rest[++i];
	} else {
		positional.push(rest[i]);
	}
}

const inputPath = positional[0];
const outputPath = positional[1];

if (!mode || !inputPath || !outputPath || !albumName || !password) {
	console.error(
		'Usage: bun run tools/crypto-file.ts <encrypt|decrypt> <input> <output> --album <name> --password <pass>'
	);
	process.exit(1);
}

console.log(`Mode:     ${mode}`);
console.log(`Input:    ${inputPath}`);
console.log(`Output:   ${outputPath}`);
console.log(`Album:    ${albumName}\n`);

console.log('Deriving key...');
const key = await deriveKey(password, albumName);

const inputData = new Uint8Array(await Bun.file(inputPath).arrayBuffer());
console.log(`Read ${inputData.byteLength} bytes`);

let result: Uint8Array;

if (mode === 'encrypt') {
	result = await encrypt(key, inputData);
	console.log(`Encrypted → ${result.byteLength} bytes`);
} else {
	try {
		result = await decrypt(key, inputData);
		console.log(`Decrypted → ${result.byteLength} bytes`);
	} catch {
		console.error('Decryption failed — wrong password or corrupted file');
		process.exit(1);
	}
}

await Bun.write(outputPath, result);
console.log(`Written to ${outputPath}`);
