<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\EmptyContentSecurityPolicy;
use OCP\IAppConfig;

/**
 * What the viewer needs beyond Nextcloud's default Content Security Policy -
 * in one place, because three documents carry the viewer: the Files page
 * (Listener\AddCspListener), the offline page and the print page (both
 * Controller\PageController). Each of them used to list the same directives;
 * a fourth copy would be the one that drifts.
 *
 * The directives themselves, each found against real browser runs rather
 * than assumed (see the listener for the measurements):
 *
 * - `wasm-unsafe-eval`: playback decodes its SoundFont samples with
 *   WebAssembly, and the conversion fallback (E7) runs the engine as
 *   WebAssembly. It is the WebAssembly-only token, not a general `eval()`.
 * - `worker-src 'self' blob:` and `connect-src blob:`, only where asked for:
 *   the engine of the fallback starts its worker from a blob URL and hands
 *   its artifacts back as blob URLs. The Files page adds them only when the
 *   fallback can apply at all (Service\ClientFallback); the app's own pages
 *   always, since a worker is part of them.
 * - The origin of a SoundFont configured outside the instance, so that
 *   `fetch()` may reach it. Without the setting nothing is widened: the app
 *   serves the SoundFont itself, and `'self'` covers that.
 */
class ViewerPolicy {
	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	/**
	 * Adds the viewer's directives to an existing policy.
	 *
	 * @param EmptyContentSecurityPolicy $policy the Files page's empty policy or a page's full one
	 * @param bool $blobWorkers whether workers and connections from blob URLs are needed
	 */
	public function apply(EmptyContentSecurityPolicy $policy, bool $blobWorkers): void {
		$policy->allowEvalWasm(true);
		if ($blobWorkers) {
			// 'self' is listed even where the default policy has it already:
			// merged policies are unions, so it costs nothing, and a policy
			// that is complete in itself cannot lose the page's own workers
			// should the merge order ever change.
			$policy->addAllowedWorkerSrcDomain("'self'");
			$policy->addAllowedWorkerSrcDomain('blob:');
			$policy->addAllowedConnectDomain('blob:');
		}
		$origin = $this->soundFontOrigin();
		if ($origin !== null) {
			$policy->addAllowedConnectDomain($origin);
		}
	}

	/**
	 * The origin of the SoundFont configured by the administration
	 * (Settings\AdminSettings), or null when the app serves its own.
	 */
	public function soundFontOrigin(): ?string {
		return self::origin($this->appConfig->getValueString(Application::APP_ID, 'soundfont_url'));
	}

	/**
	 * A complete policy for one of the app's own pages.
	 *
	 * @param bool $blobWorkers see apply()
	 */
	public function forPage(bool $blobWorkers): ContentSecurityPolicy {
		$policy = new ContentSecurityPolicy();
		$this->apply($policy, $blobWorkers);
		return $policy;
	}

	/**
	 * Scheme and host of an address, for connect-src - only http(s): a
	 * setting without a scheme, or with another one, is not an address a
	 * browser could be allowed to connect to.
	 */
	public static function origin(string $url): ?string {
		$parts = parse_url(trim($url));
		if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || !in_array($parts['scheme'], ['http', 'https'], true)) {
			return null;
		}
		return $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
	}
}
