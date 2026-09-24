<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\PushNotifier;
use OCP\App\IAppManager;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Container\NotFoundExceptionInterface;
use Psr\Log\LoggerInterface;

/**
 * notify_push ist eine Moeglichkeit, keine Abhaengigkeit (E10): Ohne die
 * App darf nichts aufgeloest werden und nichts scheitern.
 */
class PushNotifierTest extends TestCase {
	/** @var list<array{string, array}> */
	private array $gesendet = [];

	private function notifier(bool $appAktiv, ?object $queue = null, bool $aufloesbar = true): PushNotifier {
		$apps = $this->createMock(IAppManager::class);
		$apps->method('isEnabledForUser')->with('notify_push')->willReturn($appAktiv);
		$container = $this->createMock(ContainerInterface::class);
		if (!$appAktiv) {
			// Die eigentliche Zusage: ohne aktive App wird gar nicht erst
			// nach der Schnittstelle gefragt.
			$container->expects($this->never())->method('get');
		} elseif ($aufloesbar) {
			$container->method('get')->with(PushNotifier::QUEUE_INTERFACE)->willReturn($queue);
		} else {
			$container->method('get')->willThrowException(new class extends \Exception implements NotFoundExceptionInterface {
			});
		}
		return new PushNotifier($apps, $container, $this->createMock(LoggerInterface::class));
	}

	private function queue(): object {
		$test = $this;
		return new class($test) {
			public function __construct(
				private PushNotifierTest $test,
			) {
			}
			public function push(string $channel, array $message): void {
				$this->test->merke($channel, $message);
			}
		};
	}

	public function merke(string $channel, array $message): void {
		$this->gesendet[] = [$channel, $message];
	}

	public function testOhneAppKeinPushUndKeinFehler(): void {
		$notifier = $this->notifier(false);

		$this->assertFalse($notifier->isAvailable());
		$this->assertSame(0, $notifier->notify(['carla'], 42, '7'));
	}

	public function testAppAktivAberSchnittstelleFehlt(): void {
		$notifier = $this->notifier(true, aufloesbar: false);

		$this->assertFalse($notifier->isAvailable());
		$this->assertSame(0, $notifier->notify(['carla'], 42, '7'));
	}

	public function testEinObjektOhnePushZaehltNicht(): void {
		$this->assertFalse($this->notifier(true, new \stdClass())->isAvailable());
	}

	public function testSendetJePersonEinEigenesEreignis(): void {
		$notifier = $this->notifier(true, $this->queue());

		$this->assertTrue($notifier->isAvailable());
		$this->assertSame(2, $notifier->notify(['carla', 'dora'], 42, '7'));
		$this->assertSame([
			['notify_custom', ['user' => 'carla', 'message' => 'scoreview_follow', 'body' => ['fileId' => 42, 'version' => '7']]],
			['notify_custom', ['user' => 'dora', 'message' => 'scoreview_follow', 'body' => ['fileId' => 42, 'version' => '7']]],
		], $this->gesendet);
	}

	public function testOhneEmpfaengerWirdNichtsAufgeloest(): void {
		$apps = $this->createMock(IAppManager::class);
		$apps->expects($this->never())->method('isEnabledForUser');
		$notifier = new PushNotifier($apps, $this->createMock(ContainerInterface::class), $this->createMock(LoggerInterface::class));

		$this->assertSame(0, $notifier->notify([], 42, '7'));
	}

	public function testEinFehlerBeimSendenBrichtNichtsAb(): void {
		$queue = new class {
			public function push(string $channel, array $message): void {
				throw new \RuntimeException('Redis weg');
			}
		};

		$this->assertSame(0, $this->notifier(true, $queue)->notify(['carla'], 42, '7'));
	}
}
