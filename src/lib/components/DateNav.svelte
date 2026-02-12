<script lang="ts">
	import type { AssetGroup } from '$lib/types';

	let { groups, activeKey = '' }: { groups: AssetGroup[]; activeKey?: string } = $props();

	function scrollToGroup(key: string) {
		const el = document.getElementById(`group-${key}`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}
</script>

<nav class="scrollbar-hide flex gap-2 overflow-x-auto px-2 py-3 sm:px-0">
	{#each groups as group (group.key)}
		<button
			type="button"
			onclick={() => scrollToGroup(group.key)}
			class="shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all duration-200 sm:text-sm
				{activeKey === group.key
				? 'bg-accent text-bg'
				: 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'}"
		>
			{group.label}
		</button>
	{/each}
</nav>

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
