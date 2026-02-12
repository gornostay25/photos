<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import AssetGrid from '$lib/components/AssetGrid.svelte';
	import AssetPreview from '$lib/components/AssetPreview.svelte';
	import DateNav from '$lib/components/DateNav.svelte';
	import type { AlbumStore } from '$lib/stores/album-store.svelte';
	import type { Asset } from '$lib/types';

	const store = getContext<AlbumStore>('albumStore');

	let activeKey = $state('');
	let observer: IntersectionObserver | null = null;

	function openAsset(asset: Asset) {
		pushState('', { selectedAsset: $state.snapshot(asset) });
	}

	function closeAsset() {
		history.back();
	}

	onMount(() => {
		if (store.groups.length > 0) {
			activeKey = store.groups[0].key;
		}
		setupObserver();

		return () => {
			observer?.disconnect();
		};
	});

	function setupObserver() {
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const id = entry.target.id;
						const key = id.replace('group-', '');
						activeKey = key;
					}
				}
			},
			{ rootMargin: '-20% 0px -70% 0px' }
		);

		requestAnimationFrame(() => {
			const sections = document.querySelectorAll('[id^="group-"]');
			sections.forEach((section) => observer!.observe(section));
		});
	}
</script>

<svelte:head>
	<title>Photos | {store.albumName}</title>
</svelte:head>

<div class="min-h-screen pb-6 sm:pb-10">
	<header class="sticky top-0 z-20 bg-bg/90 backdrop-blur-lg">
		<div class="mx-auto max-w-5xl px-2 pt-4 pb-1 sm:pt-6">
			<h1 class="text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
				<span class="text-accent">G25 Photos | {store.albumName}</span>
			</h1>
		</div>
		{#if !store.loading}
			<div class="mx-auto max-w-5xl">
				<DateNav groups={store.groups} {activeKey} />
			</div>
		{/if}
		<div class="h-px bg-surface"></div>
	</header>

	<main class="mt-2 sm:mt-4">
		<AssetGrid
			groups={store.groups}
			loading={store.loading}
			getThumbnailBlob={(id) => store.getThumbnailBlob(id)}
			onassetclick={openAsset}
		/>
	</main>
</div>

{#if page.state.selectedAsset}
	<AssetPreview
		asset={page.state.selectedAsset}
		getOriginalBlob={(id) => store.getOriginalBlob(id)}
		getVideoBlob={(id) => store.getVideoBlob(id)}
		onclose={closeAsset}
	/>
{/if}
