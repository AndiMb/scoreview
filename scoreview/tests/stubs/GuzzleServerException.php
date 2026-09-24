<?php

declare(strict_types=1);

/**
 * Doppelgaenger fuer Guzzles ServerException. Guzzle kommt in Nextcloud aus
 * dem Server selbst und ist deshalb keine Abhaengigkeit dieses Pakets - fuer
 * einen Test, der pruefen will, wie SidecarClient ein 5xx einordnet, fehlt
 * die Klasse also. Nur geladen, wenn es die echte nicht gibt, und nur mit
 * dem, was SidecarClient liest: Statuscode und ein Header.
 */

namespace GuzzleHttp\Exception;

if (!class_exists(ServerException::class)) {
	class ServerException extends \RuntimeException {
		/** @param array<string, string> $headers */
		public function __construct(
			private int $statusCode,
			private array $headers = [],
		) {
			parent::__construct('Server error: ' . $statusCode);
		}

		public function getResponse(): object {
			$status = $this->statusCode;
			$headers = $this->headers;
			return new class($status, $headers) {
				/** @param array<string, string> $headers */
				public function __construct(
					private int $status,
					private array $headers,
				) {
				}

				public function getStatusCode(): int {
					return $this->status;
				}

				public function getHeaderLine(string $name): string {
					return $this->headers[$name] ?? '';
				}
			};
		}
	}
}
