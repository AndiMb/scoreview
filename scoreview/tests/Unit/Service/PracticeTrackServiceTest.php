<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\FileNames;
use OCA\ScoreView\Service\PracticeTrackException;
use OCA\ScoreView\Service\PracticeTrackService;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotEnoughSpaceException;
use OCP\Files\NotPermittedException;
use OCP\IConfig;
use OCP\IL10N;
use OCP\L10N\IFactory;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Wohin ein Uebe-Track geschrieben wird und was dabei verweigert wird (E13).
 */
class PracticeTrackServiceTest extends TestCase {
	/** Freier Platz im Zielordner; negativ = unbegrenzt (FileInfo::SPACE_UNLIMITED). */
	private int $frei = -3;
	private IRootFolder&MockObject $root;
	private Folder&MockObject $userFolder;
	private Folder&MockObject $parent;
	private File&MockObject $score;
	private string $language = 'de';

	protected function setUp(): void {
		$this->root = $this->createMock(IRootFolder::class);
		$this->userFolder = $this->createMock(Folder::class);
		$this->root->method('getUserFolder')->willReturn($this->userFolder);
		$this->userFolder->method('getRelativePath')->willReturnCallback(fn (string $p) => substr($p, strlen('/anna/files')));
		$this->parent = $this->createMock(Folder::class);
		$this->parent->method('getFreeSpace')->willReturnCallback(fn () => $this->frei);
		$this->score = $this->createMock(File::class);
		$this->score->method('getParent')->willReturn($this->parent);
	}

	private function service(): PracticeTrackService {
		$config = $this->createMock(IConfig::class);
		$config->method('getSystemValueString')->willReturnCallback(fn () => $this->language);
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnCallback(fn (string $text) => $this->language === 'de' ? 'Übe-Tracks' : $text);
		$factory = $this->createMock(IFactory::class);
		$factory->method('get')->willReturn($l);
		return new PracticeTrackService($this->root, $config, $factory);
	}

	private function datei(string $name): File&MockObject {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn(9);
		$file->method('getName')->willReturn($name);
		$file->method('getPath')->willReturn('/anna/files/Chor/' . $name);
		return $file;
	}

	/** @return resource */
	private function mp3() {
		$s = fopen('php://temp', 'r+');
		fwrite($s, 'ID3');
		rewind($s);
		return $s;
	}

	public function testZuWenigPlatzVorDemSchreiben(): void {
		// Gemessen: Nextcloud schriebe sonst bis an die Quota und liesse eine
		// abgeschnittene Datei zurueck.
		$this->frei = 1;
		$this->parent->method('nodeExists')->willReturn(false);
		$this->parent->method('isCreatable')->willReturn(true);
		$this->parent->expects($this->never())->method('newFile');
		try {
			$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, false);
			$this->fail('kein Fehler');
		} catch (PracticeTrackException $e) {
			$this->assertSame(PracticeTrackException::STORAGE_FULL, $e->getReason());
		}
	}

	public function testGescheitertesAnlegenRaeumtAuf(): void {
		$halb = $this->createMock(File::class);
		$halb->expects($this->once())->method('delete');
		$this->parent->method('nodeExists')->willReturnOnConsecutiveCalls(false, true);
		$this->parent->method('isCreatable')->willReturn(true);
		$this->parent->method('get')->willReturn($halb);
		$this->parent->method('newFile')->willThrowException(new NotPermittedException('quota'));
		$this->expectException(PracticeTrackException::class);
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, false);
	}

	public function testLegtNebenDerPartiturAn(): void {
		$this->parent->method('nodeExists')->willReturn(false);
		$this->parent->method('isCreatable')->willReturn(true);
		$this->parent->expects($this->once())->method('newFile')->with('Ave – Tenor.mp3')->willReturn($this->datei('Ave – Tenor.mp3'));

		$saved = $this->service()->save($this->score, 'anna', $this->mp3(), 'Ave – Tenor', 'folder', null, false);

		$this->assertSame(['fileId' => 9, 'name' => 'Ave – Tenor.mp3', 'path' => '/Chor/Ave – Tenor.mp3'], $saved);
	}

	public function testUnterordnerHeisstNachDerSpracheDerInstanz(): void {
		$sub = $this->createMock(Folder::class);
		$sub->method('getFreeSpace')->willReturn(-3);
		$sub->method('nodeExists')->willReturn(false);
		$sub->method('isCreatable')->willReturn(true);
		$sub->method('newFile')->willReturn($this->datei('x.mp3'));
		$this->parent->method('nodeExists')->willReturn(false);
		$this->parent->method('isCreatable')->willReturn(true);
		$this->parent->expects($this->once())->method('newFolder')->with('Übe-Tracks')->willReturn($sub);

		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'sub', null, false);
	}

	public function testEnglischeInstanz(): void {
		$this->language = 'en';
		$this->assertSame('Practice tracks', $this->service()->subfolderName());
	}

	public function testVorhandenerUnterordnerWirdBenutzt(): void {
		$sub = $this->createMock(Folder::class);
		$sub->method('getFreeSpace')->willReturn(-3);
		$sub->method('nodeExists')->willReturn(false);
		$sub->method('isCreatable')->willReturn(true);
		$sub->expects($this->once())->method('newFile')->willReturn($this->datei('x.mp3'));
		$this->parent->method('nodeExists')->with('Übe-Tracks')->willReturn(true);
		$this->parent->method('get')->willReturn($sub);
		$this->parent->expects($this->never())->method('newFolder');

		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'sub', null, false);
	}

	public function testGleichnamigeDateiStattUnterordner(): void {
		$this->parent->method('nodeExists')->willReturn(true);
		$this->parent->method('get')->willReturn($this->createMock(File::class));
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::INVALID));
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'sub', null, false);
	}

	public function testOhneSchreibrecht(): void {
		$this->parent->method('nodeExists')->willReturn(false);
		$this->parent->method('isCreatable')->willReturn(false);
		$this->parent->expects($this->never())->method('newFile');
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::FORBIDDEN));
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, false);
	}

	public function testKonfliktSchlaegtFreienNamenVor(): void {
		$this->parent->method('nodeExists')->willReturnCallback(fn (string $n) => in_array($n, ['x.mp3', 'x (2).mp3'], true));
		$this->parent->method('get')->willReturn($this->createMock(File::class));
		try {
			$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, false);
			$this->fail('kein Konflikt');
		} catch (PracticeTrackException $e) {
			$this->assertSame(PracticeTrackException::EXISTS, $e->getReason());
			$this->assertSame('x (3).mp3', $e->getSuggested());
		}
	}

	public function testErsetztNurMitSchreibrecht(): void {
		$alt = $this->datei('x.mp3');
		$alt->method('isUpdateable')->willReturn(false);
		$alt->expects($this->never())->method('putContent');
		$this->parent->method('nodeExists')->willReturn(true);
		$this->parent->method('get')->willReturn($alt);
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::FORBIDDEN));
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, true);
	}

	public function testErsetzt(): void {
		$alt = $this->datei('x.mp3');
		$alt->method('isUpdateable')->willReturn(true);
		$alt->expects($this->once())->method('putContent');
		$this->parent->method('nodeExists')->willReturn(true);
		$this->parent->method('get')->willReturn($alt);
		$this->assertSame(9, $this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, true)['fileId']);
	}

	public function testEigenerOrdnerNurImNutzerordner(): void {
		$this->userFolder->method('getById')->willReturn([]);
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::INVALID));
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'own', 77, false);
	}

	public function testVollesKontingent(): void {
		$this->parent->method('nodeExists')->willReturn(false);
		$this->parent->method('isCreatable')->willReturn(true);
		$this->parent->method('newFile')->willThrowException(new NotEnoughSpaceException());
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::STORAGE_FULL));
		$this->service()->save($this->score, 'anna', $this->mp3(), 'x', 'folder', null, false);
	}

	public function testUnbrauchbarerName(): void {
		$this->expectExceptionObject(new PracticeTrackException(PracticeTrackException::INVALID));
		$this->service()->save($this->score, 'anna', $this->mp3(), ' .. ', 'folder', null, false);
	}

	public function testErkenntMp3(): void {
		foreach (['ID3abc' => true, "\x00\x00\xFF\xFB\x90" => true, 'RIFF....WAVE' => false, '' => false] as $inhalt => $erwartet) {
			$s = fopen('php://temp', 'r+');
			fwrite($s, (string)$inhalt);
			rewind($s);
			$this->assertSame($erwartet, PracticeTrackService::looksLikeMp3($s), bin2hex((string)$inhalt));
			$this->assertSame(0, ftell($s));
		}
	}

	public function testFileNamesBereinigt(): void {
		$this->assertSame('AC DC', FileNames::clean("AC/DC\x07.mp3", ['.mp3']));
		$this->assertNull(FileNames::clean('..', []));
		$this->assertSame(FileNames::MAX_NAME_LENGTH, mb_strlen((string)FileNames::clean(str_repeat('ä', 300), [])));
	}
}
