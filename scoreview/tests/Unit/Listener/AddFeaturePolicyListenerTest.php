<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Listener\AddFeaturePolicyListener;
use OCA\ScoreView\Service\FeatureConfig;
use OCP\AppFramework\Http\EmptyFeaturePolicy;
use OCP\IRequest;
use OCP\Security\FeaturePolicy\AddFeaturePolicyEvent;
use PHPUnit\Framework\TestCase;

/**
 * Die Mikrofon-Freigabe (S3): Was dieser Listener hinzufuegt,
 * gilt fuer jede Seite, auf der das Ereignis feuert - und eine Erlaubnis des
 * Browsers gilt je Herkunft. Deshalb vor allem Faelle, in denen NICHTS
 * freigegeben werden darf.
 */
class AddFeaturePolicyListenerTest extends TestCase {
	/**
	 * @param array<string, string> $header
	 * @return ?EmptyFeaturePolicy null, wenn nichts hinzugefuegt wurde
	 */
	private function lauf(string|\Throwable $pfad, bool $mikrofon = true, array $header = []): ?EmptyFeaturePolicy {
		$request = $this->createMock(IRequest::class);
		if ($pfad instanceof \Throwable) {
			$request->method('getPathInfo')->willThrowException($pfad);
		} else {
			$request->method('getPathInfo')->willReturn($pfad);
		}
		$request->method('getHeader')->willReturnCallback(fn (string $name) => $header[$name] ?? '');
		$features = $this->createMock(FeatureConfig::class);
		$features->method('usesMicrophone')->willReturn($mikrofon);

		$gefangen = null;
		$event = $this->createMock(AddFeaturePolicyEvent::class);
		$event->method('addPolicy')->willReturnCallback(function (EmptyFeaturePolicy $p) use (&$gefangen): void {
			$gefangen = $p;
		});

		(new AddFeaturePolicyListener($request, $features))->handle($event);
		return $gefangen;
	}

	public function testGibtDasMikrofonAufDerFilesSeiteFrei(): void {
		foreach (['/apps/files', '/apps/files/', '/apps/files/files/42', '/apps/files/directEditing/abc'] as $pfad) {
			$richtlinie = $this->lauf($pfad);
			$this->assertNotNull($richtlinie, $pfad);
			$this->assertStringContainsString("microphone 'self'", $richtlinie->buildPolicy(), $pfad);
			// Nur das Mikrofon - alles andere bleibt Nextclouds Vorgabe.
			$this->assertStringContainsString("camera 'none'", $richtlinie->buildPolicy(), $pfad);
		}
	}

	public function testSonstNirgends(): void {
		foreach (['/apps/dashboard/', '/apps/files_sharing/x', '/apps/spreed/', '/settings/user', '/', ''] as $pfad) {
			$this->assertNull($this->lauf($pfad), $pfad);
		}
		$this->assertNull($this->lauf(new \RuntimeException('kaputt')), 'nicht dekodierbarer Pfad');
	}

	public function testNichtOhneEingeschalteteMikrofonfunktion(): void {
		$this->assertNull($this->lauf('/apps/files/', false));
	}

	/** An JSON-Antworten ist eine Richtlinie Rauschen - und jede Freigabe eine zu viel. */
	public function testNichtFuerHintergrundanfragen(): void {
		$this->assertNull($this->lauf('/apps/files/api/v1/x', true, ['X-Requested-With' => 'XMLHttpRequest']));
		$this->assertNull($this->lauf('/apps/files/api/v1/x', true, ['OCS-APIRequest' => 'true']));
	}
}
