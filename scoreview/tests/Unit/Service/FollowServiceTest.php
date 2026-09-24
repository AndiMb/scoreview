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
use OCP\DB\Exception as DbException;
use OCP\Files\Node;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcache;
use OCP\IUserManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Regeln von „Folgt mir" auf dem Server (E10 in docs/architecture.md).
 * Die Tabelle steht als Speicher im Test, der Cache ebenso -
 * so laesst sich zaehlen, wann die Datenbank ueberhaupt gefragt wird.
 *
 * Konten: anna und bert sind Leitungen, carla nicht.
 */
class FollowServiceTest extends TestCase {
	private const FILE_ID = 42;

	private FollowMapper&MockObject $mapper;
	private LeaderService&MockObject $leaders;
	private PushNotifier&MockObject $push;
	private ?FollowSession $zeile = null;
	private int $leseZugriffe = 0;
	private int $jetzt = 1790000000;
	/** Millisekunden innerhalb der Sekunde `jetzt`. */
	private int $ms = 250;
	/** @var list<array{list<string>, string}> */
	private array $gepusht = [];
	private ICache $cache;
	private bool $pushDa = false;
	/** Laeuft unmittelbar vor einem bedingten Schreiben oder Loeschen: „ein anderer Prozess". */
	private ?\Closure $dazwischen = null;

	protected function setUp(): void {
		$this->mapper = $this->createMock(FollowMapper::class);
		$this->mapper->method('findByFileId')->willReturnCallback(function () {
			$this->leseZugriffe++;
			return $this->zeile === null ? null : clone $this->zeile;
		});
		$this->mapper->method('insert')->willReturnCallback(function (FollowSession $row) {
			if ($this->zeile !== null) {
				$doppelt = $this->createMock(DbException::class);
				$doppelt->method('getReason')->willReturn(DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION);
				throw $doppelt;
			}
			$this->zeile = clone $row;
			return $row;
		});
		$this->mapper->method('update')->willReturnCallback(function (FollowSession $row) {
			$this->zeile = clone $row;
			return $row;
		});
		$this->mapper->method('updateIfVersion')->willReturnCallback(function (FollowSession $row, int $expected) {
			$this->nebenher();
			if ($this->zeile === null || $this->zeile->getVersion() !== $expected) {
				return false;
			}
			$this->zeile = clone $row;
			return true;
		});
		$this->mapper->method('deleteByFileId')->willReturnCallback(function () {
			$this->zeile = null;
			return 1;
		});
		$this->mapper->method('touchIfVersion')->willReturnCallback(function (int $fileId, int $expected, \DateTimeInterface $heartbeat) {
			$this->nebenher();
			if ($this->zeile === null || $this->zeile->getVersion() !== $expected) {
				return false;
			}
			$this->zeile->setHeartbeatAt(\DateTime::createFromInterface($heartbeat));
			return true;
		});
		$this->mapper->method('deleteIfVersion')->willReturnCallback(function (int $fileId, int $version) {
			$this->nebenher();
			if ($this->zeile === null || $this->zeile->getVersion() !== $version) {
				return 0;
			}
			$this->zeile = null;
			return 1;
		});

		$this->leaders = $this->createMock(LeaderService::class);
		$this->leaders->method('isLeader')->willReturnCallback(fn (Node $node, string $uid) => in_array($uid, ['anna', 'bert'], true));

		$this->push = $this->createMock(PushNotifier::class);
		$this->push->method('isAvailable')->willReturnCallback(fn () => $this->pushDa);
		$this->push->method('notify')->willReturnCallback(function (array $uids, int $fileId, string $version) {
			$this->gepusht[] = [$uids, $version];
			return count($uids);
		});

		$this->cache = new class implements ICache {
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
	}

	private function service(bool $verteilt = false): FollowService {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturnCallback(fn () => $this->jetzt);
		$time->method('getDateTime')->willReturnCallback(fn () => new \DateTime('@' . $this->jetzt));
		$time->method('now')->willReturnCallback(fn () => new \DateTimeImmutable(sprintf('@%d.%03d', $this->jetzt + intdiv($this->ms, 1000), $this->ms % 1000)));
		$users = $this->createMock(IUserManager::class);
		$users->method('getDisplayName')->willReturnCallback(fn (string $uid) => ucfirst($uid));
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('isAvailable')->willReturn($verteilt);
		$factory->expects($this->once())->method($verteilt ? 'createDistributed' : 'createLocal')->willReturn($this->cache);
		return new FollowService($this->mapper, $this->leaders, $users, $this->push, $time, $factory);
	}

	/** Fuehrt `dazwischen` genau einmal aus. */
	private function nebenher(): void {
		$dazwischen = $this->dazwischen;
		$this->dazwischen = null;
		if ($dazwischen !== null) {
			$dazwischen();
		}
	}

	private function node(): Node {
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn(self::FILE_ID);
		return $node;
	}

	public function testOhneSitzungIstNichtsAktiv(): void {
		$stand = $this->service()->read(self::FILE_ID);

		$this->assertSame(['version' => '0', 'active' => false], $stand);
	}

	public function testStartMitStelleSetztDiePositionAufZaehlerEins(): void {
		$stand = $this->service()->start($this->node(), 'anna', 47, 'C');

		$this->assertTrue($stand['active']);
		$this->assertSame('Anna', $stand['leaderName']);
		$this->assertSame(['seq' => 1, 'measure' => 47, 'mark' => 'C'], $stand['state']['position']);
		$this->assertSame(0, $stand['state']['loop']['seq']);
		$this->assertSame(0, $stand['state']['tone']['seq']);
		// Die Version ist zugleich die Sitzungskennung.
		$this->assertSame($stand['version'], (string)$stand['state']['session']);
	}

	public function testOhneLeitungsrolleKeinStart(): void {
		$this->expectExceptionObject(new FollowException(FollowException::NOT_LEADER));
		$this->service()->start($this->node(), 'carla');
	}

	public function testJedeAngabeZaehltIhrenZaehlerHochUndDieVersion(): void {
		$service = $this->service();
		$start = $service->start($this->node(), 'anna');
		$v0 = (int)$start['version'];

		$a = $service->change($this->node(), 'anna', ['position' => ['measure' => 12]]);
		$b = $service->change($this->node(), 'anna', ['position' => ['measure' => 12]]);
		$c = $service->change($this->node(), 'anna', ['loop' => ['from' => 40, 'to' => 48]]);
		$d = $service->change($this->node(), 'anna', ['clearLoop' => true, 'tone' => true]);

		$this->assertSame((string)($v0 + 1), $a['version']);
		// „Nochmal ab 12" ist ein neuer Befehl, auch bei gleichem Takt.
		$this->assertSame(2, $b['state']['position']['seq']);
		$this->assertSame(['seq' => 1, 'from' => 40, 'to' => 48], $c['state']['loop']);
		$this->assertSame(['seq' => 2, 'from' => null, 'to' => null], $d['state']['loop']);
		$this->assertSame(1, $d['state']['tone']['seq']);
		$this->assertSame(1790000000250, $d['state']['tone']['issuedAt'], 'Serverzeit in ms');
		$this->assertSame((string)($v0 + 4), $d['version']);
	}

	public function testLebenszeichenAendertKeineVersion(): void {
		$service = $this->service();
		$start = $service->start($this->node(), 'anna');
		$this->jetzt += 60;
		$this->gepusht = [];

		$stand = $service->change($this->node(), 'anna', ['heartbeat' => true]);

		$this->assertSame($start['version'], $stand['version']);
		$this->assertSame($this->jetzt, $stand['heartbeat']);
		$this->assertSame([], $this->gepusht, 'ein Lebenszeichen braucht niemand zu erfahren');
	}

	public function testUnsinnigeAngabenWerdenAbgelehnt(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');
		foreach ([
			['position' => ['measure' => 0]],
			['position' => ['measure' => 5, 'mark' => str_repeat('X', 17)]],
			['loop' => ['from' => 10, 'to' => 9]],
			['loop' => ['from' => 0, 'to' => 3]],
		] as $aenderung) {
			try {
				$service->change($this->node(), 'anna', $aenderung);
				$this->fail('angenommen: ' . json_encode($aenderung));
			} catch (FollowException $e) {
				$this->assertSame(FollowException::INVALID, $e->getReason());
			}
		}
	}

	public function testUebernahmeBehaeltDenZustandUndNenntDieNeueLeitung(): void {
		$service = $this->service();
		$start = $service->start($this->node(), 'anna', 47, 'C');

		$stand = $service->start($this->node(), 'bert');

		$this->assertSame('Bert', $stand['leaderName']);
		$this->assertSame($start['state']['session'], $stand['state']['session'], 'dieselbe Sitzung');
		$this->assertSame(['seq' => 1, 'measure' => 47, 'mark' => 'C'], $stand['state']['position']);
		$this->assertNotSame($start['version'], $stand['version'], 'alle Geraete sollen den Wechsel sehen');
	}

	public function testNachDerUebernahmeSendetNurNochDieNeueLeitung(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$service->start($this->node(), 'bert');

		$this->expectExceptionObject(new FollowException(FollowException::OTHER_LEADER));
		$service->change($this->node(), 'anna', ['tone' => true]);
	}

	public function testDieselbeLeitungStartetErneutOhneNeueVersion(): void {
		$service = $this->service();
		$start = $service->start($this->node(), 'anna');

		$this->assertSame($start['version'], $service->start($this->node(), 'anna')['version']);
	}

	public function testNach30MinutenOhneLebenszeichenGiltDieSitzungAlsBeendet(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');

		$this->jetzt += 30 * 60;
		$this->assertTrue($service->read(self::FILE_ID)['active'], 'genau 30 min: noch da');

		$this->jetzt += 1;
		$this->assertSame(['version' => '0', 'active' => false], $service->read(self::FILE_ID), 'auch aus dem Cache');
		$this->expectExceptionObject(new FollowException(FollowException::NO_SESSION));
		$service->change($this->node(), 'anna', ['tone' => true]);
	}

	public function testNachAblaufBeginntEineNeueSitzungMitNeuenZaehlern(): void {
		$service = $this->service();
		$alt = $service->start($this->node(), 'anna', 12);
		$this->jetzt += 31 * 60;

		$neu = $service->start($this->node(), 'bert');

		$this->assertNotSame($alt['state']['session'], $neu['state']['session']);
		$this->assertSame(0, $neu['state']['position']['seq']);
	}

	public function testEndeDurchIrgendeineLeitung(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');

		$this->assertSame(['version' => '0', 'active' => false], $service->end($this->node(), 'bert'));
		$this->assertNull($this->zeile);
		$this->assertFalse($service->read(self::FILE_ID)['active']);
	}

	public function testEndeOhneRolleVerboten(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');

		$this->expectExceptionObject(new FollowException(FollowException::NOT_LEADER));
		$service->end($this->node(), 'carla');
	}

	/**
	 * Der Kurzschluss: Unveraenderte Abfragen beantwortet der
	 * Cache - die Datenbank sieht davon keine einzige.
	 */
	public function testUnveraenderteAbfragenFragenDieDatenbankNicht(): void {
		$service = $this->service();
		$version = $service->start($this->node(), 'anna', 3)['version'];
		$this->leseZugriffe = 0;

		for ($i = 0; $i < 50; $i++) {
			$this->assertNull($service->read(self::FILE_ID, $version), '204');
		}
		$this->assertNotNull($service->read(self::FILE_ID, 'veraltet'));

		$this->assertSame(0, $this->leseZugriffe);
	}

	public function testOhneSitzungLiestNurDerErsteDieDatenbank(): void {
		$service = $this->service();

		for ($i = 0; $i < 20; $i++) {
			$this->assertNull($service->read(self::FILE_ID, '0'));
		}

		$this->assertSame(1, $this->leseZugriffe);
	}

	/**
	 * Ein aus der Datenbank gelesener Stand darf einen inzwischen von der
	 * Leitung geschriebenen nicht ueberschreiben - sonst bekaemen Geraete
	 * mit dem alten Stand 204, bis der Eintrag ablaeuft (ein verlorener
	 * Sprung). Deshalb `add` statt `set`, wo der Cache es kann.
	 */
	public function testFehlgriffLegtNurAnWennFrei(): void {
		$this->zeile = null;
		$memcache = $this->createMock(IMemcache::class);
		$memcache->method('get')->willReturn(null);
		$memcache->expects($this->once())->method('add')->with(
			'follow:' . self::FILE_ID,
			['at' => $this->jetzt * 1000 + $this->ms, 'snapshot' => ['version' => '0', 'active' => false]],
			FollowService::LOCAL_CACHE_TTL,
		);
		$memcache->expects($this->never())->method('set');
		$this->cache = $memcache;

		$this->service()->read(self::FILE_ID);
	}

	/**
	 * Mehrere Webserver ohne verteilten Cache: Jeder hat sein eigenes APCu.
	 * Aendert die Leitung ueber Server B, sieht Server A das nur ueber die
	 * Datenbank - also darf sein Eintrag hoechstens eine Sekunde gelten, sonst
	 * bekaemen seine Geraete 204 auf einen Stand, den es nicht mehr gibt.
	 */
	public function testLokalerEintragGiltHoechstensEineSekunde(): void {
		$serverA = $this->service();
		$version = $serverA->start($this->node(), 'anna', 3)['version'];
		// Server B schreibt an A vorbei: nur die Zeile aendert sich.
		$zeile = clone $this->zeile;
		$zeile->setVersion((int)$version + 1);
		$this->zeile = $zeile;

		$this->ms = 250 + 999;
		$this->assertNull($serverA->read(self::FILE_ID, $version), 'innerhalb einer Sekunde noch aus dem Cache');
		$this->ms = 250 + 1001;
		$stand = $serverA->read(self::FILE_ID, $version);

		$this->assertNotNull($stand, 'nach einer Sekunde aus der Datenbank');
		$this->assertSame((string)((int)$version + 1), $stand['version']);
	}

	public function testVerteilterEintragGiltLaenger(): void {
		$service = $this->service(verteilt: true);
		$version = $service->start($this->node(), 'anna', 3)['version'];
		$this->leseZugriffe = 0;

		$this->jetzt += 20;

		$this->assertNull($service->read(self::FILE_ID, $version));
		$this->assertSame(0, $this->leseZugriffe);
	}

	public function testMitVerteiltemCacheGiltDieser(): void {
		// Die Erwartung sitzt in service(): createDistributed genau einmal.
		$this->service(verteilt: true)->read(self::FILE_ID);
		$this->addToAssertionCount(1);
	}

	public function testGleichzeitigeAenderungGewinntImZweitenVersuch(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');
		// Beim ersten Schreiben ist eine andere Aenderung dazwischen gekommen.
		$dazwischen = true;
		$mapper = $this->createMock(FollowMapper::class);
		$mapper->method('findByFileId')->willReturnCallback(fn () => clone $this->zeile);
		$mapper->method('updateIfVersion')->willReturnCallback(function (FollowSession $row, int $expected) use (&$dazwischen) {
			if ($dazwischen) {
				$dazwischen = false;
				$this->zeile->setVersion($this->zeile->getVersion() + 1);
				return false;
			}
			$this->zeile = clone $row;
			return true;
		});
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn($this->jetzt);
		$time->method('getDateTime')->willReturnCallback(fn () => new \DateTime('@' . $this->jetzt));
		$time->method('now')->willReturnCallback(fn () => new \DateTimeImmutable('@' . $this->jetzt . '.250'));
		$factory = $this->createMock(ICacheFactory::class);
		$factory->method('createLocal')->willReturn($this->cache);
		$users = $this->createMock(IUserManager::class);
		$zweiter = new FollowService($mapper, $this->leaders, $users, $this->push, $time, $factory);
		$vorher = $this->zeile->getVersion();

		$stand = $zweiter->change($this->node(), 'anna', ['position' => ['measure' => 9]]);

		$this->assertSame((string)($vorher + 2), $stand['version'], 'auf den neuen Stand aufgesetzt, nicht ueberschrieben');
	}

	public function testPushGehtAnDieAngemeldetenOhneDieLeitung(): void {
		$this->pushDa = true;
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$this->assertTrue($service->join(self::FILE_ID, 'carla'));
		$this->assertTrue($service->join(self::FILE_ID, 'anna'));
		$this->gepusht = [];

		$stand = $service->change($this->node(), 'anna', ['position' => ['measure' => 5]]);

		$this->assertSame([[['carla'], $stand['version']]], $this->gepusht);
	}

	public function testAnmeldungLaeuftNachZweiMinutenAb(): void {
		$this->pushDa = true;
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$service->join(self::FILE_ID, 'carla');
		$this->jetzt += 121;
		$service->change($this->node(), 'anna', ['heartbeat' => true]);
		$this->gepusht = [];

		$service->change($this->node(), 'anna', ['tone' => true]);

		$this->assertSame([], $this->gepusht[0][0]);
	}

	public function testAbfrageErneuertDieAnmeldung(): void {
		$this->pushDa = true;
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$service->join(self::FILE_ID, 'carla');
		$this->jetzt += 90;
		$service->refreshMember(self::FILE_ID, 'carla');
		$this->jetzt += 90;
		$this->gepusht = [];

		$service->change($this->node(), 'anna', ['tone' => true]);

		$this->assertSame(['carla'], $this->gepusht[0][0]);
	}

	public function testOhnePushKeineAnmeldung(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');

		$this->assertFalse($service->join(self::FILE_ID, 'carla'));
		$this->assertArrayNotHasKey('follow-members:' . self::FILE_ID, $this->cache->werte);
	}

	public function testOhneSitzungKeineAnmeldung(): void {
		$this->pushDa = true;

		$this->assertFalse($this->service()->join(self::FILE_ID, 'carla'));
	}

	public function testLebenszeichenNachDemEndeErwecktNichts(): void {
		// Die Leitung sendet ihr Lebenszeichen, eine andere beendet die
		// Sitzung zwischen Lesen und Schreiben: Sie bleibt beendet.
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$this->dazwischen = fn () => $service->end($this->node(), 'bert');

		try {
			$service->change($this->node(), 'anna', ['heartbeat' => true]);
			$this->fail('Lebenszeichen fuer eine beendete Sitzung angenommen');
		} catch (FollowException $e) {
			$this->assertSame(FollowException::NO_SESSION, $e->getReason());
		}
		$this->assertNull($this->zeile);
		$this->assertFalse($service->read(self::FILE_ID)['active'], 'kein Geist im Cache');
	}

	public function testLebenszeichenUeberschreibtKeinenNeuerenStand(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');
		// Waehrend das Lebenszeichen schreibt, springt die Leitung auf einem
		// zweiten Geraet zu Takt 12.
		$this->dazwischen = fn () => $service->change($this->node(), 'anna', ['position' => ['measure' => 12]]);
		$this->jetzt += 60;

		$stand = $service->change($this->node(), 'anna', ['heartbeat' => true]);

		$neu = $service->read(self::FILE_ID);
		$this->assertSame(12, $neu['state']['position']['measure'], 'der Sprung bleibt im Cache');
		$this->assertSame($neu['version'], $stand['version'], 'das Lebenszeichen setzte auf den neuen Stand auf');
	}

	public function testLebenszeichenSchreibtNichtInDenCache(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$vorher = $this->cache->werte['follow:' . self::FILE_ID];
		$this->jetzt += 60;

		$service->change($this->node(), 'anna', ['heartbeat' => true]);

		$this->assertSame($vorher, $this->cache->werte['follow:' . self::FILE_ID]);
		$this->assertSame($this->jetzt, $this->zeile->getHeartbeatAt()->getTimestamp(), 'aber in die Zeile');
	}

	public function testAbgelaufeneZeileWirdNurInDerGelesenenFassungGeloescht(): void {
		$service = $this->service();
		$service->start($this->node(), 'anna', 12);
		$this->jetzt += 31 * 60;
		// Ein schnellerer Start hat die abgelaufene Zeile schon ersetzt.
		$this->dazwischen = function (): void {
			$neu = new FollowSession();
			$neu->setFileId(self::FILE_ID);
			$neu->setLeaderUid('anna');
			$neu->setStartedAt(new \DateTime('@' . $this->jetzt));
			$neu->setHeartbeatAt(new \DateTime('@' . $this->jetzt));
			$neu->setVersion(777);
			$neu->setState(json_encode(FollowService::initialState(777)));
			$this->zeile = $neu;
		};

		$stand = $service->start($this->node(), 'bert');

		$this->assertSame(777, $stand['state']['session'], 'die neue Sitzung des anderen uebernommen, nicht geloescht');
		$this->assertSame('Bert', $stand['leaderName']);
	}

	public function testGleichzeitigeAnmeldungenGehenNichtVerloren(): void {
		$this->pushDa = true;
		$werte = [];
		$versuche = 0;
		$memcache = $this->createMock(IMemcache::class);
		$memcache->method('get')->willReturnCallback(function ($key) use (&$werte) {
			return $werte[$key] ?? null;
		});
		$memcache->method('set')->willReturnCallback(function ($key, $value) use (&$werte) {
			$werte[$key] = $value;
			return true;
		});
		$memcache->method('remove')->willReturnCallback(function ($key) use (&$werte) {
			unset($werte[$key]);
			return true;
		});
		$memcache->method('add')->willReturnCallback(function ($key, $value) use (&$werte, &$versuche) {
			if ($key === 'follow-members-lock:' . self::FILE_ID) {
				$versuche++;
				if ($versuche === 1) {
					// Ein anderes Geraet haelt die Sperre und meldet sich an ...
					$werte['follow-members:' . self::FILE_ID] = ['dora' => $this->jetzt];
					return false;
				}
			}
			if (isset($werte[$key])) {
				return false;
			}
			$werte[$key] = $value;
			return true;
		});
		$this->cache = $memcache;
		$service = $this->service();
		$service->start($this->node(), 'anna');

		// ... und carla wartet, statt dessen Liste zu ueberschreiben.
		$service->join(self::FILE_ID, 'carla');
		$this->gepusht = [];
		$service->change($this->node(), 'anna', ['tone' => true]);

		$this->assertEqualsCanonicalizing(['dora', 'carla'], $this->gepusht[0][0]);
		$this->assertArrayNotHasKey('follow-members-lock:' . self::FILE_ID, $werte, 'Sperre wieder frei');
	}

	public function testNumerischeKennungBekommtPush(): void {
		$this->pushDa = true;
		$service = $this->service();
		$service->start($this->node(), 'anna');
		$service->join(self::FILE_ID, '1234');
		$this->gepusht = [];

		$service->change($this->node(), 'anna', ['tone' => true]);

		$this->assertSame(['1234'], $this->gepusht[0][0]);
	}

	public function testListeDerAngemeldetenIstBegrenzt(): void {
		$this->pushDa = true;
		$service = $this->service();
		$service->start($this->node(), 'anna');
		for ($i = 0; $i <= FollowService::MAX_MEMBERS; $i++) {
			$service->join(self::FILE_ID, 'geraet' . $i);
		}

		$this->assertCount(FollowService::MAX_MEMBERS, $this->cache->werte['follow-members:' . self::FILE_ID]);
	}
}
