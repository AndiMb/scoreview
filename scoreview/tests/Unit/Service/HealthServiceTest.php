<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\HealthService;
use OCA\ScoreView\Service\LocalConverter;
use OCP\IL10N;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The admin page shows the local path's `error` as is. LocalConverter has no
 * reader and therefore no language, so the cause it names in `reason` must
 * be turned into a translated message here - otherwise every admin sees the
 * converter's technical wording, whatever language they chose.
 *
 * Only localStatus() is exercised: the rest of collect() is database and
 * HTTP plumbing that has nothing to translate.
 */
class HealthServiceTest extends TestCase {
	private function localStatus(array $described): array {
		$local = $this->createMock(LocalConverter::class);
		$local->method('describe')->willReturn($described);
		$l = $this->createMock(IL10N::class);
		// Marks what went through t(), so the test sees translation happen.
		$l->method('t')->willReturnCallback(static fn (string $text): string => '[t] ' . $text);

		// Built without the constructor: a mock of IDBConnection drags in
		// IQueryBuilder, whose stub needs Doctrine DBAL, which the OCP stubs
		// do not ship. localStatus() only touches these two properties.
		$class = new \ReflectionClass(HealthService::class);
		$service = $class->newInstanceWithoutConstructor();
		$class->getProperty('localConverter')->setValue($service, $local);
		$class->getProperty('l')->setValue($service, $l);
		return $class->getMethod('localStatus')->invoke($service);
	}

	public static function reasons(): array {
		return [
			'process' => ['process', 'PHP is not allowed to start processes'],
			'node' => ['node', 'No Node.js runtime found'],
			'engine' => ['engine', 'The engine package (scoreview-engine) is missing'],
		];
	}

	#[DataProvider('reasons')]
	public function testKnownReasonReplacesTheErrorWithATranslatedMessage(string $reason, string $start): void {
		$status = $this->localStatus(['ok' => false, 'reason' => $reason, 'error' => 'technical text', 'node' => null]);

		$this->assertStringStartsWith('[t] ' . $start, $status['error']);
		$this->assertSame($reason, $status['reason']);
		$this->assertFalse($status['ok']);
		$this->assertArrayHasKey('node', $status, 'the other fields pass through unchanged');
	}

	public function testWithoutReasonTheErrorPassesThrough(): void {
		$this->assertSame(
			['ok' => true, 'reason' => null, 'error' => null],
			$this->localStatus(['ok' => true, 'reason' => null, 'error' => null]),
		);
	}

	public function testUnknownReasonKeepsTheTechnicalError(): void {
		$status = $this->localStatus(['ok' => false, 'reason' => 'something-new', 'error' => 'technical text']);

		$this->assertSame('technical text', $status['error']);
	}
}
