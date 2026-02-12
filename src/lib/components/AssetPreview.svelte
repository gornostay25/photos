<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import type { Asset } from '$lib/types';
	import { formatDateLong } from '$lib/utils';

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
	let showingVideo = $state(false);
	let loadingAsset = $state(true);
	let error: string | null = $state(null);
	let liveVideoLoading = $state(false);

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

	async function toggleLive() {
		if (asset.type !== 'live') return;

		if (!showingVideo && !videoSrc) {
			liveVideoLoading = true;
			try {
				const blob = await getVideoBlob(asset.id);
				if (blob) {
					videoSrc = URL.createObjectURL(blob);
					showingVideo = true;
				} else {
					error = 'Failed to load live video';
				}
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to load live video';
			} finally {
				liveVideoLoading = false;
			}
		} else {
			showingVideo = !showingVideo;
		}
	}

	async function loadAsset() {
		loadingAsset = true;
		error = null;

		try {
			if (asset.type === 'video') {
				const blob = await getVideoBlob(asset.id);
				if (blob) {
					videoSrc = URL.createObjectURL(blob);
				} else {
					error = 'Failed to load video — chunk may be unavailable';
				}
			} else {
				const blob = await getOriginalBlob(asset.id);
				if (blob) {
					imgSrc = URL.createObjectURL(blob);
				} else {
					error = 'Failed to load asset — chunk may be unavailable';
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'An unexpected error occurred';
		} finally {
			loadingAsset = false;
		}
	}

	function retry() {
		if (imgSrc) URL.revokeObjectURL(imgSrc);
		if (videoSrc) URL.revokeObjectURL(videoSrc);
		imgSrc = '';
		videoSrc = '';
		imgLoaded = false;
		videoLoaded = false;
		showingVideo = false;
		loadAsset();
	}

	onMount(() => {
		loadAsset();

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
		<!-- Loading spinner -->
		{#if loadingAsset}
			<div class="flex h-64 w-64 flex-col items-center justify-center gap-4 sm:h-96 sm:w-96">
				<svg
					class="h-10 w-10 animate-spin text-white/60"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
					></path>
				</svg>
				<p class="text-sm text-white/50">Loading...</p>
			</div>

			<!-- Error state -->
		{:else if error}
			<div class="flex h-64 w-64 flex-col items-center justify-center gap-4 sm:h-96 sm:w-96">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-red-400"
				>
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="8" x2="12" y2="12"></line>
					<line x1="12" y1="16" x2="12.01" y2="16"></line>
				</svg>
				<p class="max-w-xs text-center text-sm text-white/70">{error}</p>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={retry}
						class="cursor-pointer rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
					>
						Retry
					</button>
					<button
						type="button"
						onclick={onclose}
						class="cursor-pointer rounded-full bg-white/5 px-4 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
					>
						Close
					</button>
				</div>
			</div>

			<!-- Loaded content -->
		{:else}
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

			<!-- Decoding spinner (blob loaded, but img/video element still decoding) -->
			{#if !imgLoaded && !videoLoaded}
				<div class="flex h-64 w-64 items-center justify-center sm:h-96 sm:w-96">
					<svg
						class="h-8 w-8 animate-spin text-white/40"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						></path>
					</svg>
				</div>
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
							disabled={liveVideoLoading}
							class="cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors
								{showingVideo ? 'bg-accent text-bg' : 'bg-white/10 text-white hover:bg-white/20'}
								{liveVideoLoading ? 'opacity-50' : ''}"
						>
							{#if liveVideoLoading}
								Loading...
							{:else}
								{showingVideo ? 'Photo' : 'Play Live'}
							{/if}
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
		{/if}
	</div>
</div>
