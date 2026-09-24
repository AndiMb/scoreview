<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\LeaderMapper;
use OCA\ScoreView\Listener\UserDeletedListener;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\EventDispatcher\Event;
use OCP\IUser;
use OCP\User\Events\UserDeletedEvent;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * „Konto geloescht" heisst: seine Inhalte sind weg - Notizen, Ernennungen,
 * geleitete Sitzungen und Aufnahmen samt WAV. Anders als bei Dateien gibt es
 * hier keinen Papierkorb, der eine Wartezeit rechtfertigen wuerde.
 */
class UserDeletedListenerTest extends TestCase {
	private AnnotationMapper&MockObject $annotations;
	private LeaderMapper&MockObject $leaders;
	private FollowMapper&MockObject $follow;
	private RecordingStorage&MockObject $recordings;

	protected function setUp(): void {
		$this->annotations = $this->createMock(AnnotationMapper::class);
		$this->leaders = $this->createMock(LeaderMapper::class);
		$this->follow = $this->createMock(FollowMapper::class);
		$this->recordings = $this->createMock(RecordingStorage::class);
	}

	private function listener(): UserDeletedListener {
		return new UserDeletedListener(
			$this->annotations,
			$this->leaders,
			$this->follow,
			$this->recordings,
			$this->createMock(LoggerInterface::class),
		);
	}

	private function kontoGeloescht(string $uid): UserDeletedEvent {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn($uid);
		return new UserDeletedEvent($user);
	}

	public function testLoeschtAllesDerPerson(): void {
		$this->annotations->expects($this->once())->method('deleteByUserId')->with('anna')->willReturn(2);
		$this->leaders->expects($this->once())->method('deleteByUserId')->with('anna')->willReturn(1);
		$this->follow->expects($this->once())->method('deleteByLeader')->with('anna')->willReturn(1);
		$this->recordings->expects($this->once())->method('deleteAllForUser')->with('anna')->willReturn(3);

		$this->listener()->handle($this->kontoGeloescht('anna'));
	}

	/**
	 * Ein Speicherfehler bei den Aufnahmen darf die Notizen nicht retten -
	 * und umgekehrt. Jeder Teil hat seinen eigenen Fehlerzweig.
	 */
	public function testEinFehlerInEinemTeilHaeltDieAnderenNichtAuf(): void {
		$this->annotations->method('deleteByUserId')->willThrowException(new \RuntimeException('DB weg'));
		$this->leaders->expects($this->once())->method('deleteByUserId')->willReturn(0);
		$this->follow->expects($this->once())->method('deleteByLeader')->willReturn(0);
		$this->recordings->expects($this->once())->method('deleteAllForUser')->willReturn(0);

		$this->listener()->handle($this->kontoGeloescht('anna'));
	}

	public function testIgnoriertFremdeEreignisse(): void {
		$this->annotations->expects($this->never())->method('deleteByUserId');
		$this->recordings->expects($this->never())->method('deleteAllForUser');

		$this->listener()->handle(new Event());
	}
}
