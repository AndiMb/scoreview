<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\FollowSession;
use OCA\ScoreView\Service\FollowException;
use OCA\ScoreView\Service\FollowService;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\PushNotifier;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

/**
 * „Folgt mir" ueber Stueckgrenzen (V6, H7) und die Transposition fuer alle
 * (H6). Festgehalten wird:
 *
 * - Der Umzug legt auf dem Ziel eine Sitzung mit DERSELBEN Kennung an und
 *   uebernimmt die Zaehler - Folgende behalten ihre gesehenen Zaehler.
 * - Die Herkunft traegt `moved`; jeder weitere Umzug zaehlt hoeher.
 * - Wer auf dem Ziel keine Leitung ist, fuehrt dort trotzdem (D16), solange
 *   er auf der Herkunft Leitung ist - aber nur er, und nur in dieser Sitzung.
 * - Eine fremde Sitzung auf dem Ziel wird nicht uebernommen.
 */
class FollowMoveTest extends TestCase {
	/** @var array<int, FollowSession> */
	private array $zeilen = [];
	private int $jetzt = 1790000000;
	/** Wer wo Leitung ist: fileId => uids */
	private array $leitungen = [1 => ['anna'], 2 => ['carl'], 3 => ['anna'], 4 => []];

	private function service(): FollowService {
		$mapper = $this->createMock(FollowMapper::class);
		$mapper->method('findByFileId')->willReturnCallback(fn (int $id) => isset($this->zeilen[$id]) ? clone $this->zeilen[$id] : null);
		$mapper->method('insert')->willReturnCallback(function (FollowSession $row) {
			$this->zeilen[$row->getFileId()] = clone $row;
			return $row;
		});
		$mapper->method('updateIfVersion')->willReturnCallback(function (FollowSession $row, int $expected) {
			$alt = $this->zeilen[$row->getFileId()] ?? null;
			if ($alt === null || $alt->getVersion() !== $expected) {
				return false;
			}
			$this->zeilen[$row->getFileId()] = clone $row;
			return true;
		});
		$mapper->method('deleteByFileId')->willReturnCallback(function (int $id) {
			unset($this->zeilen[$id]);
			return 1;
		});
		$mapper->method('deleteIfVersion')->willReturnCallback(function (int $id, int $version) {
			if (($this->zeilen[$id] ?? null)?->getVersion() === $version) {
				unset($this->zeilen[$id]);
				return 1;
			}
			return 0;
		});
		$mapper->method('touchIfVersion')->willReturn(true);

		$leaders = $this->createMock(LeaderService::class);
		$leaders->method('isLeader')->willReturnCallback(fn (Node $node, string $uid) => in_array($uid, $this->leitungen[$node->getId()] ?? [], true));

		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturnCallback(fn () => $this->jetzt);
		$time->method('getDateTime')->willReturnCallback(fn () => new \DateTime('@' . $this->jetzt));
		$time->method('now')->willReturnCallback(fn () => new \DateTimeImmutable('@' . $this->jetzt));
		$users = $this->createMock(IUserManager::class);
		$users->method('getDisplayName')->willReturnArgument(0);
		$cache = new class implements ICache {
			public array $werte = [];
			public function get($key) {
				return $this->werte[$key] ?? null;
			}
			public function set($key, $value, $ttl = 0) {
				$this->werte[$key] = $value;
				return true;
			}
			public function hasKey($key) {
				return isset($this->werte[$key]);
			}
			public function remove($key) {
				unset($this->werte[$key]);
				return true;
			}
			public function clear($prefix = '') {
				$this->werte = [];
				return true;
			}
			public static function isAvailable(): bool {
				return true;
			}
		};
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('isAvailable')->willReturn(true);
		$factory->method('createDistributed')->willReturn($cache);

		// Der Nutzerordner liefert die Herkunft als Knoten (getragene Leitung).
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturnCallback(fn (int $id) => [$this->node($id)]);
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->willReturn($folder);

		return new FollowService($mapper, $leaders, $users, $this->createMock(PushNotifier::class), $time, $factory, $root);
	}

	private function node(int $id): Node {
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn($id);
		return $node;
	}

	private function state(int $id): array {
		return json_decode($this->zeilen[$id]->getState(), true);
	}

	public function testUmzugUebernimmtKennungUndZaehler(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna', 12);
		$s->change($this->node(1), 'anna', ['transpose' => -2, 'tone' => true]);
		$session = $this->state(1)['session'];

		$ziel = $s->move($this->node(1), $this->node(3), 'anna', 900);

		$this->assertSame($session, $ziel['state']['session'], 'dieselbe Sitzung');
		$this->assertSame(1, $ziel['state']['position']['seq']);
		$this->assertSame(['seq' => 1, 'semitones' => -2], $ziel['state']['transpose']);
		$this->assertSame(0, $ziel['state']['moved']['seq'], 'das Ziel ist nicht umgezogen');
		$this->assertSame(['seq' => 1, 'fileId' => 3, 'setlistId' => 900], $this->state(1)['moved']);
	}

	public function testWeitererUmzugZaehltHoeher(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(3), 'anna', null);
		$s->move($this->node(3), $this->node(4), 'anna', null);
		$this->assertSame(2, $this->state(3)['moved']['seq']);
		$this->assertSame(4, $this->state(3)['moved']['fileId']);
	}

	public function testGetrageneLeitungFuehrtAufDemZiel(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		// Auf 4 ist niemand Leitung - anna bringt die Sitzung hin.
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$this->assertSame(1, $this->state(4)['carriedFrom']);

		$neu = $s->change($this->node(4), 'anna', ['position' => ['measure' => 7]]);
		$this->assertSame(7, $neu['state']['position']['measure']);
		$this->assertSame(4, $neu['state']['position']['fileId']);
	}

	public function testGetrageneLeitungEndetMitDerLeitungsrolle(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$this->leitungen[1] = [];
		$this->expectExceptionObject(new FollowException(FollowException::NOT_LEADER));
		$s->change($this->node(4), 'anna', ['tone' => true]);
	}

	public function testNiemandSonstFuehrtMitGetragenerLeitung(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$this->expectExceptionObject(new FollowException(FollowException::NOT_LEADER));
		$s->change($this->node(4), 'dora', ['tone' => true]);
	}

	public function testEigeneLeitungAufDemZielBrauchtKeineHerkunft(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(3), 'anna', null);
		$this->assertNull($this->state(3)['carriedFrom']);
	}

	public function testFremdeSitzungAufDemZielBleibt(): void {
		$s = $this->service();
		$s->start($this->node(2), 'carl');
		$s->start($this->node(1), 'anna');
		try {
			$s->move($this->node(1), $this->node(2), 'anna', null);
			$this->fail('uebernommen');
		} catch (FollowException $e) {
			$this->assertSame(FollowException::OTHER_LEADER, $e->getReason());
		}
		$this->assertSame('carl', $this->zeilen[2]->getLeaderUid());
	}

	public function testOhneSitzungKeinUmzug(): void {
		$this->expectExceptionObject(new FollowException(FollowException::NO_SESSION));
		$this->service()->move($this->node(1), $this->node(3), 'anna', null);
	}

	public function testEndeAufDemZielBeendetDieHerkunft(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$s->end($this->node(4), 'anna');
		$this->assertArrayNotHasKey(4, $this->zeilen);
		$this->assertArrayNotHasKey(1, $this->zeilen);
	}

	public function testTranspositionWirdBegrenzt(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$this->expectExceptionObject(new FollowException(FollowException::INVALID));
		$s->change($this->node(1), 'anna', ['transpose' => 13]);
	}

	public function testAktivFuerBegleitToken(): void {
		$s = $this->service();
		$this->assertFalse($s->isActive(3));
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(3), 'anna', null);
		$this->assertTrue($s->isActive(3));
	}

	public function testBegleitzielNurNachUmzug(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->start($this->node(2), 'carl');
		$this->assertFalse($s->isMoveTarget(1, 2), 'fremde laufende Sitzung ist kein Ziel');
		$this->assertFalse($s->isMoveTarget(1, 3), 'noch nicht umgezogen');
		$s->move($this->node(1), $this->node(3), 'anna', null);
		$s->move($this->node(3), $this->node(4), 'anna', null);
		$this->assertTrue($s->isMoveTarget(1, 3));
		$this->assertTrue($s->isMoveTarget(1, 4), 'auch ueber mehrere Stuecke');
		$this->assertFalse($s->isMoveTarget(1, 2));
	}

	public function testKetteEndetGanz(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(3), 'anna', null);
		$s->move($this->node(3), $this->node(4), 'anna', null);
		$s->end($this->node(4), 'anna');
		$this->assertSame([], array_keys($this->zeilen));
	}

	public function testEndeLaesstEineNeueSitzungDerHerkunftStehen(): void {
		$this->leitungen[1] = ['anna', 'bert'];
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$this->jetzt += 20 * 60;
		$s->change($this->node(4), 'anna', ['tone' => true]);
		$this->jetzt += 11 * 60;
		// Die Zeile auf 1 ist abgelaufen - bert beginnt dort neu.
		$s->start($this->node(1), 'bert');
		$s->end($this->node(4), 'anna');
		$this->assertArrayHasKey(1, $this->zeilen);
		$this->assertSame('bert', $this->zeilen[1]->getLeaderUid());
	}

	public function testUebernahmeTraegtDieLeitungNichtWeiter(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$s->move($this->node(1), $this->node(4), 'anna', null);
		$this->assertSame(1, $this->state(4)['carriedFrom']);
		// dora ist auf 4 echte Leitung und uebernimmt.
		$this->leitungen[4] = ['dora'];
		$s->start($this->node(4), 'dora');
		$this->assertNull($this->state(4)['carriedFrom']);
		// Zieht dora weiter, wo sie keine Leitung ist, gilt 4 als Herkunft.
		$s->move($this->node(4), $this->node(5), 'dora', null);
		$this->assertSame(4, $this->state(5)['carriedFrom']);
		$neu = $s->change($this->node(5), 'dora', ['position' => ['measure' => 3]]);
		$this->assertSame(3, $neu['state']['position']['measure']);
	}

	public function testGeraeteSehenDieKetteNicht(): void {
		$s = $this->service();
		$s->start($this->node(1), 'anna');
		$ziel = $s->move($this->node(1), $this->node(4), 'anna', null);
		$this->assertArrayNotHasKey('carriedFrom', $ziel['state']);
		$this->assertArrayNotHasKey('movedFrom', $ziel['state']);
	}
}
