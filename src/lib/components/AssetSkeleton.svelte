<div class="aspect-square w-full overflow-hidden rounded-sm bg-skeleton">
	<div class="shimmer h-full w-full"></div>
</div>

<style>
	.shimmer {
		background: linear-gradient(
			90deg,
			var(--color-skeleton) 0%,
			var(--color-skeleton-shine) 50%,
			var(--color-skeleton) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
