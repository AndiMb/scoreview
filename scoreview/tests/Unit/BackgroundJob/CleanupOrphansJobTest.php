<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\BackgroundJob;

use OCA\ScoreView\BackgroundJob\CleanupOrphansJob;
use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\FollowSession;
use OCA\ScoreView\Db\LeaderMapper;
use OCA\ScoreView\Db\MyPartPreferenceMapper;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Der Aufraeum-Job entscheidet ueber Datenverlust: er ist die einzige Stelle,
 * die Notizen ohne Zutun der Nutzerin loescht. Die
 * Bedingung dafuer - "die fileId ist NIRGENDS mehr aufloesbar, auch nicht im
 * Papierkorb" - ist deshalb der Kern dieser Tests.
 *
 * Der Papierkorb-Fall ist kein konstruierter Sonderfall: an der Testinstanz
 * nachgemessen behaelt eine in den Papierkorb verschobene Datei ihre fileId
 * und liefert bei `IRootFolder::getById()` weiterhin einen Treffer. Genau
 * daran haengt, dass ein Wiederherstellen die Notizen zurueckbringt.
 */
class CleanupOrphansJobTest extends TestCase {
	private IRootFolder&MockObject $rootFolder;
	private ConversionService&MockObject $conversionService;
	private ScoreConversionMapper&MockObject $conversionMapper;
	private AnnotationMapper&MockObject $annotationMapper;
	private LeaderMapper&MockObject $leaderMapper;
	private FollowMapper&MockObject $followMapper;
	private RecordingStorage&MockObject $recordingStorage;
	private MyPartPreferenceMapper&MockObject $myPartPreferences;
	private ITimeFactory&MockObject $time;

	protected function setUp(): void {
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->conversionMapper = $this->createMock(ScoreConversionMapper::class);
		$this->annotationMapper = $this->createMock(AnnotationMapper::class);
		$this->leaderMapper = $this->createMock(LeaderMapper::class);
		$this->followMapper = $this->createMock(FollowMapper::class);
		$this->recordingStorage = $this->createMock(RecordingStorage::class);
		$this->myPartPreferences = $this->createMock(MyPartPreferenceMapper::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getDateTime')->willReturnCallback(fn () => new \DateTime('2026-09-24 12:00:00'));
	}

	/** Führt run() aus - die Methode ist protected, der Job wird sonst von der Queue gestartet. */
	private function jobLaufenLassen(): void {
		$job = new CleanupOrphansJob(
			$this->time,
			$this->rootFolder,
			$this->conversionService,
			$this->conversionMapper,
			$this->annotationMapper,
			$this->leaderMapper,
			$this->followMapper,
			$this->recordingStorage,
			$this->myPartPreferences,
			$this->createMock(LoggerInterface::class),
		);
		$method = new \ReflectionMethod($job, 'run');
		$method->setAccessible(true);
		$method->invoke($job, null);
	}

	/** @param array<int, bool> $existiert fileId => ist noch auffindbar */
	private function dateienBestand(array $existiert): void {
		$this->rootFolder->method('getById')->willReturnCallback(
			fn (int $id) => ($existiert[$id] ?? false) ? [$this->createMock(Node::class)] : [],
		);
	}

	public function testLoeschtNichtsFuerEineDateiImPapierkorb(): void {
		// getById() findet sie weiterhin (unter files_trashbin) - sie kann
		// zurueckgeholt werden, also bleiben Cache UND Notizen.
		$this->conversionMapper->method('findAllFileIds')->willReturn([42]);
		$this->annotationMapper->method('findAllFileIds')->willReturn([42]);
		$this->dateienBestand([42 => true]);

		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->annotationMapper->expects($this->never())->method('deleteByFileId');

		$this->jobLaufenLassen();
	}

	public function testLoeschtCacheUndNotizenWennDieDateiNirgendsMehrExistiert(): void {
		$this->conversionMapper->method('findAllFileIds')->willReturn([42]);
		$this->annotationMapper->method('findAllFileIds')->willReturn([42]);
		$this->dateienBestand([]);

		$this->conversionService->expects($this->once())->method('deleteAllForFile')->with(42);
		$this->annotationMapper->expects($this->once())->method('deleteByFileId')->with(42)->willReturn(3);

		$this->jobLaufenLassen();
	}

	public function testBehandeltJedeDateiEinzeln(): void {
		$this->conversionMapper->method('findAllFileIds')->willReturn([1, 2]);
		$this->annotationMapper->method('findAllFileIds')->willReturn([2, 3]);
		$this->dateienBestand([2 => true]);

		$geloescht = [];
		$this->conversionService->method('deleteAllForFile')
			->willReturnCallback(function (int $id) use (&$geloescht): void {
				$geloescht[] = $id;
			});
		$this->annotationMapper->method('deleteByFileId')->willReturn(0);

		$this->jobLaufenLassen();

		sort($geloescht);
		$this->assertSame([1, 3], $geloescht, 'nur die verschwundenen fileIds');
	}

	public function testEineKaputteFileIdBeendetDenDurchlaufNicht(): void {
		$this->conversionMapper->method('findAllFileIds')->willReturn([1, 2]);
		$this->annotationMapper->method('findAllFileIds')->willReturn([]);
		$this->dateienBestand([]);

		$this->conversionService->method('deleteAllForFile')
			->willReturnCallback(function (int $id): void {
				if ($id === 1) {
					throw new \RuntimeException('Speicher weg');
				}
			});
		// fileId 2 muss trotz des Fehlers bei 1 noch drankommen.
		$this->annotationMapper->expects($this->once())->method('deleteByFileId')->with(2)->willReturn(0);

		$this->jobLaufenLassen();
	}

	public function testLoeschtNichtsWennDieAuflösungSelbstScheitert(): void {
		// Ein Speicherfehler beim Nachsehen darf nicht als "Datei ist weg"
		// durchgehen - im Zweifel bleibt alles stehen.
		$this->conversionMapper->method('findAllFileIds')->willReturn([42]);
		$this->annotationMapper->method('findAllFileIds')->willReturn([]);
		$this->rootFolder->method('getById')->willThrowException(new \RuntimeException('Speicher nicht erreichbar'));

		$this->conversionService->expects($this->never())->method('deleteAllForFile');
		$this->annotationMapper->expects($this->never())->method('deleteByFileId');

		$this->jobLaufenLassen();
	}

	// --- Leitungen, Folge-Sitzungen, Aufnahmen ---------------------------

	/**
	 * Dieselbe Papierkorb-Regel wie fuer die Notizen: Wer eine Partitur aus
	 * dem Papierkorb zurueckholt, bekommt Leitungen und Aufnahmen zurueck.
	 */
	public function testLaesstLeitungenUndAufnahmenEinerDateiImPapierkorbStehen(): void {
		$this->leaderMapper->method('findAllFileIds')->willReturn([42]);
		$this->recordingStorage->method('findAllFileIds')->willReturn([42]);
		$this->followMapper->method('findAllFileIds')->willReturn([42]);
		$this->dateienBestand([42 => true]);

		$this->leaderMapper->expects($this->never())->method('deleteByFileId');
		$this->followMapper->expects($this->never())->method('deleteByFileId');
		$this->recordingStorage->expects($this->never())->method('deleteAllForFile');

		$this->jobLaufenLassen();
	}

	/**
	 * Eine fileId, die NUR in einer der neuen Tabellen vorkommt, muss trotzdem
	 * gefunden werden - eine Partitur mit Aufnahme, aber ohne Notiz und ohne
	 * Cache ist der Normalfall nach einem Neukonvertieren.
	 */
	public function testRaeumtAllesZuEinerEndgueltigGeloeschtenDateiAb(): void {
		$this->recordingStorage->method('findAllFileIds')->willReturn([7]);
		$this->leaderMapper->method('findAllFileIds')->willReturn([8]);
		$this->followMapper->method('findAllFileIds')->willReturn([9]);
		$this->dateienBestand([]);

		$leitungen = [];
		$this->leaderMapper->method('deleteByFileId')
			->willReturnCallback(function (int $id) use (&$leitungen): int {
				$leitungen[] = $id;
				return 1;
			});
		$aufnahmen = [];
		$this->recordingStorage->method('deleteAllForFile')
			->willReturnCallback(function (int $id) use (&$aufnahmen): int {
				$aufnahmen[] = $id;
				return 1;
			});
		$sitzungen = [];
		$this->followMapper->method('deleteByFileId')
			->willReturnCallback(function (int $id) use (&$sitzungen): int {
				$sitzungen[] = $id;
				return 1;
			});

		$this->jobLaufenLassen();

		sort($leitungen);
		sort($aufnahmen);
		sort($sitzungen);
		$this->assertSame([7, 8, 9], $leitungen);
		$this->assertSame([7, 8, 9], $aufnahmen, 'Aufnahmen samt IAppData-Ordner ueber RecordingStorage');
		$this->assertSame([7, 8, 9], $sitzungen);
	}

	/**
	 * „Meine Stimme" haengt je Partitur in den Nutzereinstellungen und kommt
	 * sonst in keiner Tabelle vor - eine Datei, zu der nur jemand eine Stimme
	 * gewaehlt hat, muss trotzdem gefunden werden.
	 */
	public function testRaeumtDieStimmwahlZuEinerEndgueltigGeloeschtenDateiAb(): void {
		$this->myPartPreferences->method('findAllFileIds')->willReturn([11, 12]);
		$this->dateienBestand([12 => true]);

		$this->myPartPreferences->expects($this->once())->method('deleteByFileId')->with(11)->willReturn(2);

		$this->jobLaufenLassen();
	}

	public function testRaeumtSitzungenOhneLebenszeichenAb(): void {
		$this->followMapper->expects($this->once())->method('deleteHeartbeatBefore')
			->with($this->callback(function (\DateTimeInterface $grenze): bool {
				$erwartet = (new \DateTime('2026-09-24 12:00:00'))->modify('-' . FollowSession::TIMEOUT_SECONDS . ' seconds');
				return $grenze->getTimestamp() === $erwartet->getTimestamp();
			}));

		$this->jobLaufenLassen();
	}

	public function testEinFehlerBeiDenSitzungenVerhindertDasAufraeumenNicht(): void {
		$this->followMapper->method('deleteHeartbeatBefore')->willThrowException(new \RuntimeException('DB weg'));
		$this->conversionMapper->method('findAllFileIds')->willReturn([42]);
		$this->dateienBestand([]);

		$this->conversionService->expects($this->once())->method('deleteAllForFile')->with(42);

		$this->jobLaufenLassen();
	}
}
