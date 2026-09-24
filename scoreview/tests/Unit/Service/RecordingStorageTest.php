<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Db\RecordingMapper;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Zeilen und WAV-Dateien verschwinden zusammen. Wer nur die Zeilen loescht,
 * laesst Megabytes an Ton im Speicher liegen, die niemand mehr findet - und
 * das bei den persoenlichsten Daten, die die App kennt.
 */
class RecordingStorageTest extends TestCase {
	private IAppData&MockObject $appData;
	private RecordingMapper&MockObject $mapper;

	protected function setUp(): void {
		$this->appData = $this->createMock(IAppData::class);
		$this->mapper = $this->createMock(RecordingMapper::class);
	}

	private function storage(): RecordingStorage {
		return new RecordingStorage($this->appData, $this->mapper);
	}

	/**
	 * @param array<string, array<string, ISimpleFolder>> $ordner uid => fileId => Ordner
	 */
	private function baum(array $ordner): void {
		$byUser = [];
		foreach ($ordner as $uid => $dateien) {
			$user = $this->createMock(ISimpleFolder::class);
			$user->method('getFolder')->willReturnCallback(function (string $name) use ($dateien) {
				return $dateien[$name] ?? throw new NotFoundException($name);
			});
			$byUser[$uid] = $user;
		}
		$root = $this->createMock(ISimpleFolder::class);
		$root->method('getFolder')->willReturnCallback(function (string $name) use ($byUser) {
			return $byUser[$name] ?? throw new NotFoundException($name);
		});
		$this->appData->method('getFolder')->with(RecordingStorage::ROOT_FOLDER)->willReturn($root);
	}

	public function testLoeschtZuEinerDateiDieOrdnerAllerAufnehmendenUndDieZeilen(): void {
		$annasOrdner = $this->createMock(ISimpleFolder::class);
		$annasOrdner->expects($this->once())->method('delete');
		$bensOrdner = $this->createMock(ISimpleFolder::class);
		$bensOrdner->expects($this->once())->method('delete');
		$this->baum(['anna' => ['42' => $annasOrdner], 'ben' => ['42' => $bensOrdner]]);
		$this->mapper->method('findUserIdsByFileId')->with(42)->willReturn(['anna', 'ben']);
		$this->mapper->expects($this->once())->method('deleteByFileId')->with(42)->willReturn(2);

		$this->assertSame(2, $this->storage()->deleteAllForFile(42));
	}

	public function testEineZeileOhneOrdnerIstKeinFehler(): void {
		$this->baum(['anna' => []]);
		$this->mapper->method('findUserIdsByFileId')->willReturn(['anna']);
		$this->mapper->expects($this->once())->method('deleteByFileId')->willReturn(1);

		$this->assertSame(1, $this->storage()->deleteAllForFile(42));
	}

	public function testLoeschtBeimKontoDenGanzenOrdnerDerNutzerin(): void {
		$annasOrdner = $this->createMock(ISimpleFolder::class);
		$annasOrdner->expects($this->once())->method('delete');
		$root = $this->createMock(ISimpleFolder::class);
		$root->method('getFolder')->with('anna')->willReturn($annasOrdner);
		$this->appData->method('getFolder')->willReturn($root);
		$this->mapper->expects($this->once())->method('deleteByUserId')->with('anna')->willReturn(4);

		$this->assertSame(4, $this->storage()->deleteAllForUser('anna'));
	}

	public function testOhneJeAufgenommenZuHabenLoeschtEsNurZeilen(): void {
		$this->appData->method('getFolder')->willThrowException(new NotFoundException('recordings'));
		$this->mapper->expects($this->once())->method('deleteByUserId')->willReturn(0);

		$this->assertSame(0, $this->storage()->deleteAllForUser('anna'));
	}

	public function testLegtDenAblageordnerBeiBedarfAn(): void {
		$dateiOrdner = $this->createMock(ISimpleFolder::class);
		$nutzerOrdner = $this->createMock(ISimpleFolder::class);
		$nutzerOrdner->method('getFolder')->willThrowException(new NotFoundException('7'));
		$nutzerOrdner->expects($this->once())->method('newFolder')->with('7')->willReturn($dateiOrdner);
		$root = $this->createMock(ISimpleFolder::class);
		$root->method('getFolder')->willThrowException(new NotFoundException('anna'));
		$root->expects($this->once())->method('newFolder')->with('anna')->willReturn($nutzerOrdner);
		$this->appData->method('getFolder')->willThrowException(new NotFoundException('recordings'));
		$this->appData->expects($this->once())->method('newFolder')->with('recordings')->willReturn($root);

		$this->assertSame($dateiOrdner, $this->storage()->folderFor('anna', 7));
		$this->assertSame('12.wav', RecordingStorage::fileName(12));
	}

	/**
	 * @param array<string, ISimpleFolder> $nutzer uid => Nutzerordner
	 */
	private function wurzel(array $nutzer): void {
		$root = $this->createMock(ISimpleFolder::class);
		$root->method('getFolder')->willReturnCallback(function (string $name) use ($nutzer) {
			return $nutzer[$name] ?? throw new NotFoundException($name);
		});
		$this->appData->method('getFolder')->with(RecordingStorage::ROOT_FOLDER)->willReturn($root);
	}

	public function testRaeumtNachDemAufraeumenLeereNutzerordnerWeg(): void {
		// anna hat nur Aufnahmen zu 42 -> ihr Ordner geht mit; ben hat noch
		// welche zu anderen Partituren -> sein Ordner bleibt.
		$annasDatei = $this->createMock(ISimpleFolder::class);
		$annasDatei->expects($this->once())->method('delete');
		$anna = $this->createMock(ISimpleFolder::class);
		$anna->method('getFolder')->with('42')->willReturn($annasDatei);
		$anna->expects($this->once())->method('delete');
		$bensDatei = $this->createMock(ISimpleFolder::class);
		$bensDatei->expects($this->once())->method('delete');
		$ben = $this->createMock(ISimpleFolder::class);
		$ben->method('getFolder')->with('42')->willReturn($bensDatei);
		$ben->expects($this->never())->method('delete');
		$this->wurzel(['anna' => $anna, 'ben' => $ben]);
		$this->mapper->method('findUserIdsByFileId')->willReturn(['anna', 'ben']);
		$this->mapper->expects($this->once())->method('deleteByFileId')->willReturn(3);
		$this->mapper->method('hasAnyForUser')->willReturnMap([['anna', false], ['ben', true]]);

		$this->assertSame(3, $this->storage()->deleteAllForFile(42));
	}

	private function aufnahme(): Recording {
		$recording = new Recording();
		$recording->setId(12);
		$recording->setFileId(42);
		$recording->setUserId('anna');
		return $recording;
	}

	public function testDieLetzteAufnahmeNimmtDateiUndNutzerordnerMit(): void {
		$wav = $this->createMock(ISimpleFile::class);
		$wav->expects($this->once())->method('delete');
		$dateiOrdner = $this->createMock(ISimpleFolder::class);
		$dateiOrdner->method('getFile')->with('12.wav')->willReturn($wav);
		$dateiOrdner->expects($this->once())->method('delete');
		$anna = $this->createMock(ISimpleFolder::class);
		$anna->method('getFolder')->with('42')->willReturn($dateiOrdner);
		$anna->expects($this->once())->method('delete');
		$this->wurzel(['anna' => $anna]);
		$this->mapper->expects($this->once())->method('delete');
		$this->mapper->method('findByFileAndUser')->with(42, 'anna')->willReturn([]);
		$this->mapper->method('hasAnyForUser')->with('anna')->willReturn(false);

		$this->storage()->delete($this->aufnahme());
	}

	public function testSolangeAufnahmenBleibenBleibtDerOrdner(): void {
		$wav = $this->createMock(ISimpleFile::class);
		$dateiOrdner = $this->createMock(ISimpleFolder::class);
		$dateiOrdner->method('getFile')->willReturn($wav);
		$dateiOrdner->expects($this->never())->method('delete');
		$anna = $this->createMock(ISimpleFolder::class);
		$anna->method('getFolder')->willReturn($dateiOrdner);
		$anna->expects($this->never())->method('delete');
		$this->wurzel(['anna' => $anna]);
		$this->mapper->method('findByFileAndUser')->willReturn([new Recording()]);
		$this->mapper->expects($this->never())->method('hasAnyForUser');

		$this->storage()->delete($this->aufnahme());
	}
}
