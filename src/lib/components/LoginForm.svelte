<script lang="ts">
	import { onMount } from 'svelte';
	import { AlbumStore } from '$lib/stores/album-store.svelte';

	let {
		onsubmit,
		loading = false,
		error = null
	}: {
		onsubmit: (albumName: string, password: string) => void;
		loading?: boolean;
		error?: string | null;
	} = $props();

	let albumName = $state('');
	let password = $state('');
	let recentAlbums: string[] = $state([]);
	let passwordInput: HTMLInputElement | undefined = $state();

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (albumName.trim() && password) {
			onsubmit(albumName.trim(), password);
		}
	}

	function selectRecentAlbum(name: string) {
		albumName = name;
		requestAnimationFrame(() => {
			passwordInput?.focus();
		});
	}

	onMount(() => {
		recentAlbums = AlbumStore.getRecentAlbums();
	});
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<form onsubmit={handleSubmit} class="w-full max-w-sm rounded-xl bg-surface p-6 shadow-lg sm:p-8">
		<h1 class="mb-6 text-center text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
			<span class="text-accent">G25 Photos</span>
		</h1>

		{#if error}
			<div class="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
				{error}
			</div>
		{/if}

		<div class="mb-4">
			<label for="album-name" class="mb-1.5 block text-sm font-medium text-text-secondary">
				Album
			</label>
			<input
				id="album-name"
				type="text"
				bind:value={albumName}
				placeholder="album name"
				required
				disabled={loading}
				class="w-full rounded-lg border border-surface-hover bg-bg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 transition-colors outline-none focus:border-accent disabled:opacity-50"
			/>
		</div>

		<div class="mb-6">
			<label for="password" class="mb-1.5 block text-sm font-medium text-text-secondary">
				Password
			</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				bind:this={passwordInput}
				placeholder="••••••••"
				required
				disabled={loading}
				class="w-full rounded-lg border border-surface-hover bg-bg px-3 py-2.5 text-sm text-text-primary placeholder-text-secondary/40 transition-colors outline-none focus:border-accent disabled:opacity-50"
			/>
		</div>

		<button
			type="submit"
			disabled={loading || !albumName.trim() || !password}
			class="w-full cursor-pointer rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{#if loading}
				Decrypting...
			{:else}
				Open Album
			{/if}
		</button>

		{#if recentAlbums.length > 0}
			<div class="mt-6">
				<h3 class="mb-3 text-sm font-semibold text-text-secondary">Recent Albums</h3>
				<div class="flex flex-wrap gap-2">
					{#each recentAlbums as name (name)}
						<button
							type="button"
							onclick={() => selectRecentAlbum(name)}
							disabled={loading}
							class="rounded-full bg-surface-hover px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-accent hover:text-bg disabled:opacity-50"
						>
							{name}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</form>
</div>
