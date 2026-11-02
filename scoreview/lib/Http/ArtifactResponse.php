<?php

declare(strict_types=1);

namespace OCA\ScoreView\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
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
