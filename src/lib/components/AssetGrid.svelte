<script lang="ts">
	import type { Asset, AssetGroup } from '$lib/types';
	import AssetCard from './AssetCard.svelte';
	import AssetSkeleton from './AssetSkeleton.svelte';

	let {
		groups,
		loading = false,
		getThumbnailBlob,
		onassetclick
	}: {
		groups: AssetGroup[];
		loading?: boolean;
		getThumbnailBlob: (id: number) => Promise<Blob | null>;
		onassetclick?: (asset: Asset) => void;
	} = $props();

	const skeletonCount = 12;
</script>

<div class="mx-auto max-w-5xl px-2 sm:px-4">
	{#if loading}
		<div>
			<div class="mb-4 h-5 w-32 rounded bg-skeleton"></div>
			<div class="grid grid-cols-3 gap-1 sm:gap-2">
				{#each Array(skeletonCount), i (i)}
					<AssetSkeleton />
				{/each}
			</div>
		</div>
	{:else}
		{#each groups as group (group.key)}
			<section id="group-{group.key}" class="mb-6 sm:mb-8" aria-label={group.label}>
				<h2
					class="sticky top-0 z-10 bg-bg/80 py-2 text-sm font-semibold tracking-wide text-text-secondary backdrop-blur-md sm:py-3 sm:text-base"
				>
					{group.label}
					<span class="ml-1.5 text-xs font-normal text-text-secondary/50"
						>{group.assets.length}</span
					>
				</h2>
				<div class="grid grid-cols-3 gap-1 sm:gap-2">
					{#each group.assets as asset (asset.id)}
						<AssetCard {asset} {getThumbnailBlob} onclick={onassetclick} />
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>
