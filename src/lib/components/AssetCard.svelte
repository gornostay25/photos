<script lang="ts">
	import { onMount } from 'svelte';
	import type { Asset } from '$lib/types';
	import { formatDateShort } from '$lib/utils';
	import AssetSkeleton from './AssetSkeleton.svelte';

	let {
		asset,
		getThumbnailBlob,
		onclick
	}: {
		asset: Asset;
		getThumbnailBlob: (id: number) => Promise<Blob | null>;
		onclick?: (asset: Asset) => void;
	} = $props();

	let src = $state('');
	let loaded = $state(false);
	let visible = $state(false);
	let el: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (!el) return;

		const obs = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					visible = true;
					obs.disconnect();
				}
			},
			{ rootMargin: '300px' }
		);

		obs.observe(el);

		return () => {
			obs.disconnect();
			if (src) URL.revokeObjectURL(src);
		};
	});

	$effect(() => {
		if (visible && !src) {
			getThumbnailBlob(asset.id).then((blob) => {
				if (blob) src = URL.createObjectURL(blob);
			});
		}
	});
</script>

<div
	bind:this={el}
	class="group relative aspect-square w-full cursor-pointer overflow-hidden bg-surface"
	onclick={() => onclick?.(asset)}
	onkeydown={(e) => e.key === 'Enter' && onclick?.(asset)}
	role="button"
	tabindex="0"
>
	{#if !loaded}
		<div class="absolute inset-0">
			<AssetSkeleton />
		</div>
	{/if}

	{#if src}
		<img
			{src}
			alt="Asset {asset.id}"
			loading="lazy"
			class="h-full w-full object-cover transition-all duration-300 group-hover:scale-[1.03] group-hover:brightness-110"
			class:opacity-0={!loaded}
			class:opacity-100={loaded}
			onload={() => (loaded = true)}
		/>
	{/if}

	<!-- Type badge -->
	{#if asset.type === 'video' && loaded}
		<div class="absolute inset-0 flex items-center justify-center">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white sm:h-12 sm:w-12"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M8 5v14l11-7z" />
				</svg>
			</div>
		</div>
	{/if}

	{#if asset.type === 'live' && loaded}
		<div
			class="absolute top-1.5 left-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase sm:text-[10px]"
		>
			LIVE
		</div>
	{/if}

	<!-- Date overlay -->
	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent px-1.5 pt-5 pb-1.5 transition-opacity duration-300 sm:px-2 sm:pb-2"
		class:opacity-0={!loaded}
		class:opacity-100={loaded}
	>
		<span class="text-[10px] font-medium text-white/80 sm:text-xs"
			>{formatDateShort(asset.date)}</span
		>
	</div>
</div>
