/**
 * Shared utility functions.
 */

/**
 * Format a date string as short date (e.g. "12 лют.").
 */
export function formatDateShort(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('uk-UA', {
		day: 'numeric',
		month: 'short'
	});
}

/**
 * Format a date string as long date (e.g. "12 лютого 2025").
 */
export function formatDateLong(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString('uk-UA', {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}
