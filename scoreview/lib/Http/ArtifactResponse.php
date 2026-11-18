<?php

declare(strict_types=1);

namespace OCA\ScoreView\Http;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\IRequest;

/**
 * A cached artifact (page SVG, timing, measures, meta), streamed from its
 * handle and gzip-compressed on the way out when the browser accepts it.
 *
 * **Why the app compresses itself.** Pages are 0.3-1 MB of SVG, the JSON
 * artifacts tens of kB, and both shrink to a fifth or less. Measured on the
 * stock Nextcloud image: Debian's `deflate.conf` lists neither
 * `image/svg+xml` nor `application/json`, so a page went over the wire
 * uncompressed - on a phone in the rehearsal room the difference between
 * turning a page now and in a second. Relying on every admin to extend their
 * web server would leave most installations as they are. A web server that
 * does compress these types leaves a response alone that already carries a
 * `Content-Encoding` (Apache mod_deflate and nginx gzip both do), so nothing
 * is compressed twice.
 *
 * **Why in callback().** Nextcloud skips the callback for a 304 (the ETag
 * check of NotModifiedMiddleware runs after the controller), so a revalidated
 * page costs no compression; and streaming through `deflate_add()` keeps the
 * file out of PHP memory as StreamResponse did.
 *
 * @template-extends Response<Http::STATUS_*, array<string, mixed>>
 */
class ArtifactResponse extends Response implements ICallbackResponse {
	/**
	 * A year: what sits under an artifact URL never changes, because the
	 * URL carries the version of what it shows (version()).
	 */
	public const IMMUTABLE_CACHE_SECONDS = 31536000;

	/** Below this the gzip header and a round of zlib are not worth it. */
	private const MIN_BYTES = 1024;
	private const CHUNK = 65536;
	/** zlib's default - level 9 costs twice the time for a few percent. */
	private const LEVEL = 6;

	private bool $gzip;

	/**
	 * @param resource|closed-resource $handle
	 */
	public function __construct(
		private $handle,
		string $mimeType,
		IRequest $request,
		?int $size = null,
	) {
		parent::__construct(Http::STATUS_OK);
		$this->gzip = self::compressible($mimeType)
			&& ($size === null || $size >= self::MIN_BYTES)
			&& self::acceptsGzip($request->getHeader('Accept-Encoding'))
			&& function_exists('deflate_init');
		$this->addHeader('Content-Type', $mimeType);
		// Caches between server and browser must keep the two forms apart.
		$this->addHeader('Vary', 'Accept-Encoding');
		if ($this->gzip) {
			$this->addHeader('Content-Encoding', 'gzip');
		}
	}

	/**
	 * A cached artifact of a base conversion or a variant, as both artifact
	 * routes deliver it - one place, so that the two cannot drift apart.
	 *
	 * `Content-Disposition: attachment`: the SVG is sanitised in the browser
	 * (ScorePage.vue -> lib/svgSanitizer.js), where the viewer fetches it.
	 * Opened directly, it would be a document on Nextcloud's origin; the
	 * header makes that moot, and an XHR does not care.
	 *
	 * The ETag is the Nextcloud file's etag, not IAppData's: the content is
	 * invariant for (fileId, etag) (ConversionService), so it is a stable
	 * HTTP ETag without depending on the storage backend of IAppData.
	 * Nextcloud's NotModifiedMiddleware answers 304 from it.
	 */
	public static function immutable(ISimpleFile $file, string $mimeType, IRequest $request, string $etag, \DateTime $lastModified): self {
		$response = new self($file->read(), $mimeType, $request, $file->getSize());
		$response->addHeader('Content-Disposition', 'attachment');
		$response->setETag($etag);
		$response->setLastModified($lastModified);
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}

	/**
	 * The `v` of an artifact URL: what tells one conversion's URL from
	 * another's. The server does not read it back (it resolves the etag from
	 * the file anyway); it exists as the browser's cache key, so that
	 * `immutable` tells the truth.
	 *
	 * Both parts, because there are two kinds of change: the etag names the
	 * version of the SCORE (an edit, a re-upload), the timestamp the
	 * CONVERSION of that version - a format upgrade or "Convert again" leaves
	 * the etag alone and would stay invisible otherwise. One formula for the
	 * base and its variants: a variant points at the base's MIDI, and two
	 * formulas would give the same MIDI two URLs.
	 */
	public static function version(ScoreConversion|ScoreVariant $row): string {
		return $row->getEtag() . '-' . $row->getUpdatedAt()->getTimestamp();
	}

	public function isCompressed(): bool {
		return $this->gzip;
	}

	public function callback(IOutput $output): void {
		if (!is_resource($this->handle)) {
			return;
		}
		if (!$this->gzip) {
			while (!feof($this->handle)) {
				$chunk = fread($this->handle, self::CHUNK);
				if ($chunk === false) {
					break;
				}
				$output->setOutput($chunk);
			}
			fclose($this->handle);
			return;
		}
		$context = deflate_init(ZLIB_ENCODING_GZIP, ['level' => self::LEVEL]);
		while (!feof($this->handle)) {
			$chunk = fread($this->handle, self::CHUNK);
			if ($chunk === false) {
				break;
			}
			$compressed = deflate_add($context, $chunk, ZLIB_NO_FLUSH);
			if ($compressed !== '') {
				$output->setOutput($compressed);
			}
		}
		$output->setOutput(deflate_add($context, '', ZLIB_FINISH));
		fclose($this->handle);
	}

	/** Text formats only - the SoundFont and the engine's wasm are not artifacts. */
	public static function compressible(string $mimeType): bool {
		$type = strtolower(trim(explode(';', $mimeType)[0]));
		return $type === 'image/svg+xml' || $type === 'application/json';
	}

	/**
	 * Whether `gzip` (or `*`) is listed with a non-zero quality. A browser
	 * always sends it; the check is for clients that explicitly refuse.
	 */
	public static function acceptsGzip(string $header): bool {
		$star = null;
		foreach (explode(',', strtolower($header)) as $part) {
			$fields = array_map('trim', explode(';', $part));
			$coding = $fields[0];
			$q = 1.0;
			foreach (array_slice($fields, 1) as $param) {
				if (str_starts_with($param, 'q=')) {
					$q = (float)substr($param, 2);
				}
			}
			if ($coding === 'gzip' || $coding === 'x-gzip') {
				return $q > 0;
			}
			if ($coding === '*') {
				$star = $q > 0;
			}
		}
		return $star === true;
	}
}
