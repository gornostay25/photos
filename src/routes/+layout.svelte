<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import './layout.css';
	import LoginForm from '$lib/components/LoginForm.svelte';
	import { AlbumStore } from '$lib/stores/album-store.svelte';

	let { children } = $props();

	const store = new AlbumStore();
	setContext('albumStore', store);

	let loggedIn = $state(false);
	let loginLoading = $state(false);
	let loginError: string | null = $state(null);

	async function handleLogin(albumName: string, password: string) {
		loginLoading = true;
		loginError = null;

		try {
			const success = await store.init(albumName, password);

			if (success) {
				loggedIn = true;
				sessionStorage.setItem('album-creds', JSON.stringify({ albumName, password }));
				AlbumStore.saveRecentAlbum(albumName);
			} else {
				loginError = store.error ?? 'Wrong password or album not found';
			}
		} catch (err) {
			loginError = err instanceof Error ? err.message : 'Login failed';
		} finally {
			loginLoading = false;
		}
	}

	// function handleLogout() {
	// 	store.destroy();
	// 	loggedIn = false;
	// 	loginError = null;
	// 	sessionStorage.removeItem('album-creds');
	// }

	onMount(() => {
		const hash = window.location.hash;
		if (hash.length > 1) {
			const raw = hash.slice(1);
			const colonIdx = raw.indexOf(':');
			if (colonIdx > 0) {
				const album = decodeURIComponent(raw.slice(0, colonIdx));
				const pass = decodeURIComponent(raw.slice(colonIdx + 1));
				history.replaceState(null, '', window.location.pathname);
				handleLogin(album, pass);
				return () => store.destroy();
			}
		}

		try {
			const saved = sessionStorage.getItem('album-creds');
			if (saved) {
				const { albumName, password } = JSON.parse(saved);
				if (albumName && password) {
					handleLogin(albumName, password);
					return () => store.destroy();
				}
			}
		} catch {
			/* ignore corrupt data */
		}

		return () => store.destroy();
	});
</script>

<svelte:head>
	<title>G25 Photos</title>
</svelte:head>

{#if loggedIn}
	{@render children()}
{:else}
	<LoginForm onsubmit={handleLogin} loading={loginLoading} error={loginError} />
{/if}
