<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Listener\CompanionRevocationListener;
use OCA\ScoreView\Service\CompanionTokenService;
use OCP\EventDispatcher\Event;
use OCP\IUser;
use OCP\User\Events\PasswordUpdatedEvent;
use OCP\User\Events\UserChangedEvent;
use PHPUnit\Framework\TestCase;

/**
 * Widerruf der Begleit-Token ueber die Epoche (S1).
 */
class CompanionRevocationListenerTest extends TestCase {
	/** @var list<string> */
	private array $gehoben = [];

	private function lauf(Event $event): void {
		$dienst = $this->createMock(CompanionTokenService::class);
		$dienst->method('bumpEpoch')->willReturnCallback(function (string $uid): void {
			$this->gehoben[] = $uid;
		});
		(new CompanionRevocationListener($dienst))->handle($event);
	}

	private function anna(): IUser {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('anna');
		return $user;
	}

	public function testPasswortwechselWiderruft(): void {
		$this->lauf(new PasswordUpdatedEvent($this->anna(), 'neu'));
		$this->assertSame(['anna'], $this->gehoben);
	}

	public function testDeaktivierenWiderruft(): void {
		$this->lauf(new UserChangedEvent($this->anna(), 'enabled', false, true));
		$this->assertSame(['anna'], $this->gehoben);
	}

	/** Andere Aenderungen am Konto - auch das Wiederaktivieren - lassen die Token stehen. */
	public function testAndereAenderungenNicht(): void {
		$this->lauf(new UserChangedEvent($this->anna(), 'enabled', true, false));
		$this->lauf(new UserChangedEvent($this->anna(), 'displayName', 'Anna', 'A.'));
		$this->lauf(new UserChangedEvent($this->anna(), 'quota', '1 GB', 'none'));
		$this->assertSame([], $this->gehoben);
	}
}
