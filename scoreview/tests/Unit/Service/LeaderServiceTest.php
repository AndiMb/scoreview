<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\Leader;
use OCA\ScoreView\Db\LeaderMapper;
use OCA\ScoreView\Service\LeaderException;
use OCA\ScoreView\Service\LeaderService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Collaboration\Collaborators\ISearch;
use OCP\Constants;
use OCP\DB\Exception as DbException;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NoUserException;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Share\IShare;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Regeln der Leitungsrolle (B1). Die Abnahme im Anforderungsdokument
 * spielt sie mit echten Konten durch; hier steht jede Regel einzeln, damit
 * eine spaetere Aenderung genau die verletzte Zusage nennt:
 *
 * - Eigentuemerin ist immer Leitung und nicht abberufbar,
 * - jede Leitung ernennt und beruft ab,
 * - ernannt wird nur, wer die Datei sieht; ohne Zugriff wirkt ein Eintrag
 *   nicht,
 * - ohne Eigentuemerin ist Leitung, wer schreiben darf (E9).
 *
 * Konten im Test: anna (Eigentuemerin), bert (ernannt), carla (sieht die
 * Datei, keine Leitung), dora (sieht die Datei nicht).
 */
class LeaderServiceTest extends TestCase {
	private const FILE_ID = 42;

	private LeaderMapper&MockObject $mapper;
	private IRootFolder&MockObject $rootFolder;
	private IUserManager&MockObject $userManager;
	private ISearch&MockObject $search;
	/** @var array<string, Leader> uid => Eintrag */
	private array $eintraege = [];
	/** @var list<string> wer die Datei im eigenen Dateibaum findet */
	private array $mitZugriff = ['anna', 'bert', 'carla'];

	protected function setUp(): void {
		$this->mapper = $this->createMock(LeaderMapper::class);
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->userManager = $this->createMock(IUserManager::class);
		$this->search = $this->createMock(ISearch::class);

		$this->eintraege = ['bert' => $this->eintrag('bert')];
		$this->mapper->method('findByFileAndUser')
			->willReturnCallback(fn (int $fileId, string $uid) => $fileId === self::FILE_ID ? ($this->eintraege[$uid] ?? null) : null);
		$this->mapper->method('findByFileId')
			->willReturnCallback(fn () => array_values($this->eintraege));

		$this->rootFolder->method('getUserFolder')->willReturnCallback(function (string $uid) {
			if ($uid === 'geloescht') {
				throw new NoUserException();
			}
			$folder = $this->createMock(Folder::class);
			$folder->method('getById')->willReturn(in_array($uid, $this->mitZugriff, true) ? [$this->createMock(Node::class)] : []);
			return $folder;
		});
		$this->userManager->method('getDisplayName')->willReturnCallback(fn (string $uid) => ucfirst($uid));
	}

	private function service(): LeaderService {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getDateTime')->willReturn(new \DateTime('2026-09-23 12:00:00'));
		return new LeaderService($this->mapper, $this->rootFolder, $this->userManager, $this->search, $time);
	}

	private function eintrag(string $uid): Leader {
		$leader = new Leader();
		$leader->setFileId(self::FILE_ID);
		$leader->setUserId($uid);
		$leader->setAppointedBy('anna');
		return $leader;
	}

	/**
	 * @param ?string $owner UID der Eigentuemerin, null = keine
	 */
	private function datei(?string $owner = 'anna', int $permissions = Constants::PERMISSION_READ): Node&MockObject {
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn(self::FILE_ID);
		$node->method('getPermissions')->willReturn($permissions);
		if ($owner === null) {
			$node->method('getOwner')->willReturn(null);
		} else {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($owner);
			$user->method('getDisplayName')->willReturn(ucfirst($owner));
			$node->method('getOwner')->willReturn($user);
		}
		return $node;
	}

	private function abgelehnt(string $grund, callable $aufruf): void {
		try {
			$aufruf();
			$this->fail('Erwartet: LeaderException ' . $grund);
		} catch (LeaderException $e) {
			$this->assertSame($grund, $e->getReason());
		}
	}

	// --- isLeader --------------------------------------------------------

	public function testEigentuemerinIstLeitungOhneEintrag(): void {
		$this->eintraege = [];
		$this->assertTrue($this->service()->isLeader($this->datei(), 'anna'));
	}

	public function testErnannteIstLeitung(): void {
		$this->assertTrue($this->service()->isLeader($this->datei(), 'bert'));
	}

	public function testOhneEintragKeineLeitung(): void {
		$this->assertFalse($this->service()->isLeader($this->datei(), 'carla'));
	}

	public function testSchreibrechtAlleinMachtBeiEigentuemerinNiemandenZurLeitung(): void {
		// Das Schreibrecht zaehlt nur ohne Eigentuemerin. Sonst waere
		// jede Freigabe mit Bearbeiten-Haken still eine Ernennung.
		$this->assertFalse($this->service()->isLeader($this->datei('anna', Constants::PERMISSION_ALL), 'carla'));
	}

	public function testOhneEigentuemerinIstSchreibrechtLeitung(): void {
		$this->assertTrue($this->service()->isLeader($this->datei(null, Constants::PERMISSION_READ | Constants::PERMISSION_UPDATE), 'carla'));
	}

	public function testOhneEigentuemerinReichtLesenNicht(): void {
		$this->assertFalse($this->service()->isLeader($this->datei(null, Constants::PERMISSION_READ), 'carla'));
	}

	// --- appoint ---------------------------------------------------------

	public function testEigentuemerinErnennt(): void {
		$this->eintraege = [];
		$this->mapper->expects($this->once())->method('insert')->with($this->callback(
			fn (Leader $l) => $l->getFileId() === self::FILE_ID && $l->getUserId() === 'carla' && $l->getAppointedBy() === 'anna',
		))->willReturnArgument(0);

		$this->service()->appoint($this->datei(), 'anna', 'carla');
	}

	public function testErnannteErnenntWeiter(): void {
		$this->mapper->expects($this->once())->method('insert')->with($this->callback(
			fn (Leader $l) => $l->getUserId() === 'carla' && $l->getAppointedBy() === 'bert',
		))->willReturnArgument(0);

		$this->service()->appoint($this->datei(), 'bert', 'carla');
	}

	public function testNichtLeitungDarfNichtErnennen(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->abgelehnt(LeaderException::NOT_LEADER, fn () => $this->service()->appoint($this->datei(), 'carla', 'carla'));
	}

	public function testOhneDateizugriffNichtErnennbar(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->abgelehnt(LeaderException::NOT_APPOINTABLE, fn () => $this->service()->appoint($this->datei(), 'anna', 'dora'));
	}

	public function testUnbekanntesKontoNichtErnennbar(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->abgelehnt(LeaderException::NOT_APPOINTABLE, fn () => $this->service()->appoint($this->datei(), 'anna', 'geloescht'));
		$this->abgelehnt(LeaderException::NOT_APPOINTABLE, fn () => $this->service()->appoint($this->datei(), 'anna', ''));
	}

	public function testErneutesErnennenIstKeinFehlerUndKeinZweiterEintrag(): void {
		$this->mapper->expects($this->never())->method('insert');
		$this->service()->appoint($this->datei(), 'anna', 'bert');
		// Die Eigentuemerin bekommt nie einen Eintrag - sonst waere sie ueber
		// ihn abberufbar.
		$this->service()->appoint($this->datei(), 'bert', 'anna');
	}

	public function testGleichzeitigeErnennungEndetImVorhandenenEintrag(): void {
		$doppelt = new class('doppelt') extends DbException {
			public function getReason(): ?int {
				return DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION;
			}
		};
		$this->mapper->method('insert')->willThrowException($doppelt);

		$this->service()->appoint($this->datei(), 'anna', 'carla');
		$this->addToAssertionCount(1);
	}

	// --- revoke ----------------------------------------------------------

	public function testLeitungBeruftAb(): void {
		$bert = $this->eintraege['bert'];
		$this->eintraege['carla'] = $this->eintrag('carla');
		$this->mapper->expects($this->once())->method('delete')->with($bert);

		// carla nimmt bert zurueck - wer wen ernannt hat, spielt keine Rolle.
		$this->service()->revoke($this->datei(), 'carla', 'bert');
	}

	public function testEigentuemerinNichtAbberufbar(): void {
		$this->mapper->expects($this->never())->method('delete');
		$this->abgelehnt(LeaderException::OWNER, fn () => $this->service()->revoke($this->datei(), 'bert', 'anna'));
		$this->abgelehnt(LeaderException::OWNER, fn () => $this->service()->revoke($this->datei(), 'anna', 'anna'));
	}

	public function testNichtLeitungDarfNichtAbberufen(): void {
		$this->mapper->expects($this->never())->method('delete');
		$this->abgelehnt(LeaderException::NOT_LEADER, fn () => $this->service()->revoke($this->datei(), 'carla', 'bert'));
	}

	public function testAbberufenOhneErnennung(): void {
		$this->abgelehnt(LeaderException::NOT_APPOINTED, fn () => $this->service()->revoke($this->datei(), 'anna', 'carla'));
	}

	// --- listLeaders -----------------------------------------------------

	public function testListeBeginntMitDerEigentuemerin(): void {
		$this->assertSame([
			['userId' => 'anna', 'displayName' => 'Anna', 'isOwner' => true],
			['userId' => 'bert', 'displayName' => 'Bert', 'isOwner' => false],
		], $this->service()->listLeaders($this->datei()));
	}

	public function testErnennungOhneDateizugriffWirktNicht(): void {
		// bert verliert die Freigabe: Er faellt aus der Liste und ist keine
		// Leitung mehr - der Eintrag bleibt, damit eine zurueckgegebene
		// Freigabe ihn wieder wirksam macht.
		$this->mitZugriff = ['anna', 'carla'];
		$this->mapper->expects($this->never())->method('delete');

		$this->assertSame(['anna'], array_column($this->service()->listLeaders($this->datei()), 'userId'));
	}

	public function testOhneEigentuemerinNurDieErnannten(): void {
		$this->assertSame(['bert'], array_column($this->service()->listLeaders($this->datei(null)), 'userId'));
	}

	// --- candidates ------------------------------------------------------

	/**
	 * @param list<string> $exakt
	 * @param list<string> $weitere
	 */
	private function suchergebnis(array $exakt, array $weitere): array {
		$eintrag = fn (string $uid) => ['label' => ucfirst($uid) . ' Name', 'value' => ['shareType' => IShare::TYPE_USER, 'shareWith' => $uid]];
		return [[
			'exact' => ['users' => array_map($eintrag, $exakt)],
			'users' => array_map($eintrag, $weitere),
		], false];
	}

	public function testVorschlaegeNurMitDateizugriffUndOhneBisherigeLeitungen(): void {
		$this->search->expects($this->once())->method('search')
			->with('ar', [IShare::TYPE_USER], false, $this->greaterThanOrEqual(LeaderService::MAX_CANDIDATES), 0)
			->willReturn($this->suchergebnis(['carla'], ['anna', 'bert', 'dora', 'carla']));

		$this->assertSame(
			[['userId' => 'carla', 'displayName' => 'Carla Name']],
			$this->service()->candidates($this->datei(), 'anna', ' ar '),
		);
	}

	public function testKurzerSuchbegriffSuchtNicht(): void {
		$this->search->expects($this->never())->method('search');
		$this->assertSame([], $this->service()->candidates($this->datei(), 'anna', 'c'));
	}

	public function testHoechstensZwanzigVorschlaege(): void {
		$viele = array_map(fn (int $i) => 'person' . $i, range(1, 30));
		$this->mitZugriff = [...$this->mitZugriff, ...$viele];
		$this->search->method('search')->willReturn($this->suchergebnis([], $viele));

		$this->assertCount(LeaderService::MAX_CANDIDATES, $this->service()->candidates($this->datei(), 'anna', 'person'));
	}

	public function testDieZugriffspruefungenSindGedeckelt(): void {
		// Jede Pruefung loest einen fremden Dateibaum auf. Sieht kaum ein
		// Treffer die Datei, sollen es trotzdem nicht beliebig viele werden -
		// auch nicht mit exakten Treffern obendrauf.
		$ohneZugriff = array_map(fn (int $i) => 'fremd' . $i, range(1, 60));
		$this->search->method('search')->willReturn($this->suchergebnis(array_slice($ohneZugriff, 0, 20), array_slice($ohneZugriff, 20)));
		$aufgeloest = 0;
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->rootFolder->method('getUserFolder')->willReturnCallback(function () use (&$aufgeloest) {
			$aufgeloest++;
			$folder = $this->createMock(Folder::class);
			$folder->method('getById')->willReturn([]);
			return $folder;
		});

		$this->assertSame([], $this->service()->candidates($this->datei(), 'anna', 'fremd'));
		$this->assertLessThanOrEqual(30, $aufgeloest);
	}

	public function testBisherigeLeitungenKostenKeineZugriffspruefung(): void {
		// Ausgeschlossen wird direkt aus der Tabelle, nicht ueber
		// listLeaders() - fuer bert wird kein Dateibaum aufgeloest.
		$this->search->method('search')->willReturn($this->suchergebnis([], ['bert', 'carla']));
		$aufgeloest = [];
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->rootFolder->method('getUserFolder')->willReturnCallback(function (string $uid) use (&$aufgeloest) {
			$aufgeloest[] = $uid;
			$folder = $this->createMock(Folder::class);
			$folder->method('getById')->willReturn([$this->createMock(Node::class)]);
			return $folder;
		});

		$this->assertSame(['carla'], array_column($this->service()->candidates($this->datei(), 'anna', 'ar'), 'userId'));
		$this->assertSame(['carla'], $aufgeloest);
	}

	public function testVorschlaegeNurFuerLeitungen(): void {
		$this->search->expects($this->never())->method('search');
		$this->abgelehnt(LeaderException::NOT_LEADER, fn () => $this->service()->candidates($this->datei(), 'carla', 'ber'));
	}
}
