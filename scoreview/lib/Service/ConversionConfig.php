<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\IAppConfig;

/**
 * The names of the app settings around conversion and playback, and the
 * readers for those that more than one class interprets.
 *
 * Constants rather than string literals because a key is read in one class
 * and written in another (SettingsController, AdminSettings): a typo in one
 * of them is a setting that silently never takes effect. The settings that
 * belong to one class keep their constant there - ConversionBackend::
 * CONFIG_KEY, SoundFontService::FETCH_URL_KEY, ClientFallback's verdict.
 * Migrations keep their literals: they describe the schema of their time.
 */
final class ConversionConfig {
	/** Largest score the server converts; larger ones end as `too_large`. */
	public const MAX_SCORE_BYTES = 'max_score_bytes';
	/** Largest score the browser fallback (E7) converts. */
	public const CLIENT_MAX_SCORE_BYTES = 'client_max_score_bytes';
	public const SIDECAR_URL = 'sidecar_url';
	public const SIDECAR_SECRET = 'sidecar_secret';
	/** Path to node or deno for the local path (E18); empty searches for node. */
	public const NODE_PATH = 'node_path';
	public const LOCAL_TIMEOUT = 'local_timeout';
	public const CJK_FONT_DIR = 'cjk_font_dir';
	/** A SoundFont address the BROWSER loads from, bypassing the app's own (E1). */
	public const SOUNDFONT_URL = 'soundfont_url';
	/** Convert every new or changed score at once instead of on first opening. */
	public const EAGER_CONVERSION = 'eager_conversion';
	/** Display variants (E19) engraved at the same time, instance-wide (occ only). */
	public const VARIANT_MAX_PARALLEL = 'variant_max_parallel';

	/**
	 * Two: a variant takes 3-4 s, so a third request waits a poll or two,
	 * and two converter processes of up to 250 MB each fit beside a small
	 * server's PHP workers. A larger server raises it with occ.
	 */
	public const DEFAULT_VARIANT_MAX_PARALLEL = 2;

	/**
	 * Without a limit the app would hand any file to the converter, however
	 * large. Streaming the upload (SidecarClient) keeps that from being a
	 * memory problem, but an absurd file still holds a MuseScore process
	 * until its timeout. 100 MB is far above any real score (the largest
	 * .mscz measured in the test set is under 1 MB) and below the sidecar's
	 * upload limit (200 MB), so that the refusal happens here, with its own
	 * error code, rather than as an opaque 413 from there.
	 */
	public const DEFAULT_MAX_SCORE_BYTES = 100 * 1024 * 1024;

	private function __construct() {
	}

	/** 0 or less means no limit. */
	public static function maxScoreBytes(IAppConfig $appConfig): int {
		return $appConfig->getValueInt(Application::APP_ID, self::MAX_SCORE_BYTES, self::DEFAULT_MAX_SCORE_BYTES);
	}

	/** Whether a score of this size is past the server's limit. */
	public static function exceedsMaxScoreBytes(IAppConfig $appConfig, int $size): bool {
		$max = self::maxScoreBytes($appConfig);
		return $max > 0 && $size > $max;
	}

	/** At least one - a limit of zero would never engrave anything. */
	public static function variantMaxParallel(IAppConfig $appConfig): int {
		return max(1, $appConfig->getValueInt(Application::APP_ID, self::VARIANT_MAX_PARALLEL, self::DEFAULT_VARIANT_MAX_PARALLEL));
	}

	/**
	 * The configured browser SoundFont address, trimmed - read in four
	 * places (status endpoint, CSP, diagnostics, admin page), and a stray
	 * space must mean the same in all of them.
	 */
	public static function browserSoundFontUrl(IAppConfig $appConfig): string {
		return trim($appConfig->getValueString(Application::APP_ID, self::SOUNDFONT_URL));
	}
}
