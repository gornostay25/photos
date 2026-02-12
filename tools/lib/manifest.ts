import type { ChunkInfo } from './chunker';

export interface MonthGroup {
	date: string; // "YYYY-MM-01"
	startId: number;
	count: number;
}

export interface Manifest {
	totalAssets: number;
	chunks: ChunkInfo[];
	months: MonthGroup[];
}

/**
 * Group asset dates by month and generate manifest.
 * Assets must already be sorted by date ascending.
 * Each asset's index in the array is its id.
 */
export function generateManifest(dates: Date[], chunks: ChunkInfo[]): Manifest {
	const months: MonthGroup[] = [];
	let currentMonthKey = '';
	let currentGroup: MonthGroup | null = null;

	for (let id = 0; id < dates.length; id++) {
		const date = dates[id];
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const monthKey = `${year}-${month}-01`;

		if (monthKey !== currentMonthKey) {
			if (currentGroup) {
				months.push(currentGroup);
			}
			currentGroup = { date: monthKey, startId: id, count: 1 };
			currentMonthKey = monthKey;
		} else {
			currentGroup!.count++;
		}
	}

	if (currentGroup) {
		months.push(currentGroup);
	}

	return {
		totalAssets: dates.length,
		chunks,
		months
	};
}
