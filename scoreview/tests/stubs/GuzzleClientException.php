<?php

declare(strict_types=1);

/**
 * Stand-in for Guzzle's ClientException, for the same reason as
 * GuzzleServerException.php: Guzzle comes with the Nextcloud server, not with
 * this package. Only what SidecarClient reads - the status code.
 */

namespace GuzzleHttp\Exception;

if (!class_exists(ClientException::class)) {
	class ClientException extends \RuntimeException {
		public function __construct(
			private int $statusCode,
		) {
			parent::__construct('Client error: ' . $statusCode);
		}

		public function getResponse(): object {
			$status = $this->statusCode;
			return new class($status) {
				public function __construct(
					private int $status,
				) {
				}

				public function getStatusCode(): int {
					return $this->status;
				}
			};
		}
	}
}
