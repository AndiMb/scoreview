<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\BackgroundJob;

use OCA\ScoreView\BackgroundJob\CleanupOrphansJob;
use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Der Aufraeum-Job entscheidet ueber Datenverlust: er ist die einzige Stelle,
 * die Notizen ohne Zutun der Nutzerin loescht (Codereview-Befund A4). Die
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

	protected function setUp(): void {
		$this->rootFolder = $this->createMock(IRootFolder::class);
		$this->conversionService = $this->createMock(ConversionService::class);
		$this->conversionMapper = $this->createMock(ScoreConversionMapper::class);
		$this->annotationMapper = $this->createMock(AnnotationMapper::class);
	}

	/** Führt run() aus - die Methode ist protected, der Job wird sonst von der Queue gestartet. */
	private function jobLaufenLassen(): void {
		$job = new CleanupOrphansJob(
			$this->createMock(ITimeFactory::class),
			$this->rootFolder,
			$this->conversionService,
			$this->conversionMapper,
			$this->annotationMapper,
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
}
