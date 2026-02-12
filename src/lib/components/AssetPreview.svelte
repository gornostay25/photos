<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import type { Asset } from '$lib/types';
	import { formatDateLong } from '$lib/utils';
	import AssetSkeleton from './AssetSkeleton.svelte';

	let {
		asset,
		getOriginalBlob,
		getVideoBlob,
		onclose
	}: {
		asset: Asset;
		getOriginalBlob: (id: number) => Promise<Blob | null>;
		getVideoBlob: (id: number) => Promise<Blob | null>;
		onclose: () => void;
	} = $props();

	let imgSrc = $state('');
	let videoSrc = $state('');
	let imgLoaded = $state(false);
	let videoLoaded = $state(false);
	let showingVideo = $state(false); // for live photos: toggle between photo and video
	let loadingAsset = $state(true);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function download() {
		const src = showingVideo ? videoSrc : imgSrc;
		if (!src) return;

		const ext = showingVideo || asset.type === 'video' ? 'mp4' : 'avif';
		const a = document.createElement('a');
		a.href = src;
		a.download = `asset-${asset.id}.${ext}`;
		a.click();
	}

	function toggleLive() {
		if (asset.type !== 'live') return;

		if (!showingVideo && !videoSrc) {
			// Load video on first toggle
			getVideoBlob(asset.id).then((blob) => {
				if (blob) {
					videoSrc = URL.createObjectURL(blob);
					showingVideo = true;
				}
			});
		} else {
			showingVideo = !showingVideo;
		}
	}

	onMount(() => {
		if (asset.type === 'video') {
			// Video-only: fetch video
			getVideoBlob(asset.id).then((blob) => {
				if (blob) videoSrc = URL.createObjectURL(blob);
				loadingAsset = false;
			});
		} else {
			// Photo or live: fetch the still image
			getOriginalBlob(asset.id).then((blob) => {
				if (blob) imgSrc = URL.createObjectURL(blob);
				loadingAsset = false;
			});
		}

		return () => {
			if (imgSrc) URL.revokeObjectURL(imgSrc);
			if (videoSrc) URL.revokeObjectURL(videoSrc);
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
	transition:fade={{ duration: 200 }}
	onclick={handleBackdropClick}
>
	<!-- Close button -->
	<button
		type="button"
		class="absolute top-4 right-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
		onclick={onclose}
		aria-label="Close preview"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<line x1="18" y1="6" x2="6" y2="18"></line>
			<line x1="6" y1="6" x2="18" y2="18"></line>
		</svg>
	</button>

	<div
		class="flex max-h-[90vh] max-w-4xl flex-col items-center"
		transition:scale={{ start: 0.95, duration: 200 }}
	>
		<!-- Loading skeleton -->
		{#if loadingAsset && !imgLoaded && !videoLoaded}
			<div class="flex h-64 w-64 items-center justify-center sm:h-96 sm:w-96">
				<div class="h-full w-full overflow-hidden rounded-lg">
					<AssetSkeleton />
				</div>
			</div>
		{/if}

		<!-- Photo display (photo or live-photo still) -->
		{#if (asset.type === 'photo' || asset.type === 'live') && imgSrc}
			<img
				src={imgSrc}
				alt="Asset {asset.id}"
				class="max-h-[80vh] max-w-full rounded-lg object-contain"
				class:hidden={!imgLoaded || showingVideo}
				onload={() => (imgLoaded = true)}
			/>
		{/if}

		<!-- Video display (standalone video or live-photo video) -->
		{#if (asset.type === 'video' || showingVideo) && videoSrc}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				src={videoSrc}
				class="max-h-[80vh] max-w-full rounded-lg object-contain"
				class:hidden={asset.type === 'live' && !showingVideo}
				controls
				autoplay
				onloadeddata={() => (videoLoaded = true)}
			></video>
		{/if}

		<!-- Bottom info bar -->
		{#if imgLoaded || videoLoaded}
			<div class="mt-3 flex items-center gap-3">
				<p class="text-xs text-text-secondary">{formatDateLong(asset.date)}</p>

				<!-- Live photo toggle -->
				{#if asset.type === 'live'}
					<button
						type="button"
						onclick={toggleLive}
						class="cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors
							{showingVideo ? 'bg-accent text-bg' : 'bg-white/10 text-white hover:bg-white/20'}"
					>
						{showingVideo ? 'Photo' : 'Play Live'}
					</button>
				{/if}

				<!-- Download button -->
				<button
					type="button"
					onclick={download}
					class="flex cursor-pointer items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white transition-colors hover:bg-white/20"
					aria-label="Download"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
						<polyline points="7 10 12 15 17 10"></polyline>
						<line x1="12" y1="15" x2="12" y2="3"></line>
					</svg>
					Download
				</button>
			</div>
		{/if}
	</div>
</div>
