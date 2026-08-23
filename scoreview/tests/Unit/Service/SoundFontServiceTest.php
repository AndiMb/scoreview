<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\SoundFontService;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IConfig;
use OCP\ITempManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * getOrFetch() traegt die Zusage aus Phase 9, dass Wiedergabe den Sidecar
 * NICHT braucht - nur die Konvertierung. Das haengt allein an den
 * Rueckfallpfaden hier, und die sind von aussen nur als "es kommt Ton" bzw.
 * "es kommt keiner" sichtbar. Genau die Sorte Logik, die ein Refactoring
 * still umdreht (Codereview-Befund B5).
 */
class SoundFontServiceTest extends TestCase {
	private IAppData&MockObject $appData;
	private SidecarClient&MockObject $sidecar;
	private IConfig&MockObject $config;
	private ITempManager&MockObject $tempManager;

	protected function setUp(): void {
		$this->appData = $this->createMock(IAppData::class);
		$this->sidecar = $this->createMock(SidecarClient::class);
		$this->config = $this->createMock(IConfig::class);
		$this->tempManager = $this->createMock(ITempManager::class);
	}

	private function service(): SoundFontService {
		return new SoundFontService($this->appData, $this->sidecar, $this->config, $this->tempManager);
	}

	/** Legt einen IAppData-Ordner an, der die Cache-Datei mit der gegebenen Groesse enthaelt. */
	private function withCachedFile(int $size): ISimpleFile&MockObject {
		$file = $this->createMock(ISimpleFile::class);
		$file->method('getSize')->willReturn($size);
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('getFile')->with('soundfont.sf3')->willReturn($file);
		$this->appData->method('getFolder')->with('soundfont')->willReturn($folder);
		return $file;
	}

	private function withoutCache(): void {
		$this->appData->method('getFolder')->willThrowException(new NotFoundException());
	}

	public function testLiefertCacheWennSidecarNichtErreichbarIst(): void {
		// Der eigentliche Punkt der Phase-9-Korrektur: eine Probe darf nicht
		// verstummen, nur weil der Konvertierungsdienst gerade weg ist.
		$cached = $this->withCachedFile(40_000_000);
		$this->sidecar->method('fetchSoundFontInfo')
			->willThrowException(new SidecarException('Verbindung abgelehnt'));

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testWirftWennWederCacheNochSidecarDaSind(): void {
		$this->withoutCache();
		$this->sidecar->method('fetchSoundFontInfo')
			->willThrowException(new SidecarException('Verbindung abgelehnt'));

		$this->expectException(SidecarException::class);
		$this->service()->getOrFetch();
	}

	public function testLiefertCacheWennDasImageKeinSoundFontMehrMitbringt(): void {
		// available:false ist kein Fehler, sondern eine gueltige Antwort
		// (siehe SidecarClient) - eine vorhandene Kopie bleibt trotzdem gut.
		$cached = $this->withCachedFile(40_000_000);
		$this->sidecar->method('fetchSoundFontInfo')->willReturn(['available' => false]);

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testWirftMitHandlungsanweisungWennNirgendsEinSoundFontIst(): void {
		$this->withoutCache();
		$this->sidecar->method('fetchSoundFontInfo')->willReturn(['available' => false]);

		$this->expectException(SidecarException::class);
		$this->expectExceptionMessageMatches('/SCOREVIEW_SOUNDFONT_PATH/');
		$this->service()->getOrFetch();
	}

	public function testLaedtNichtErneutWennDieVersionUnveraendertIst(): void {
		// Der Versionsabgleich ist bei JEDEM Aufruf drin (siehe Kommentar in
		// SoundFontService); er darf deshalb nicht jedes Mal 40 MB ziehen.
		$cached = $this->withCachedFile(40_000_000);
		$this->sidecar->method('fetchSoundFontInfo')
			->willReturn(['available' => true, 'version' => 'abc123']);
		$this->config->method('getAppValue')
			->with('scoreview', 'soundfont_cache_version', '')
			->willReturn('abc123');
		$this->sidecar->expects($this->never())->method('downloadSoundFontTo');

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testLaedtNeuWennDasImageEinAnderesSoundFontMitbringt(): void {
		// Content-Hash als Cache-Schluessel: ein SoundFont-Wechsel im Image
		// invalidiert Server- und Browser-Cache automatisch (Phase 9).
		$this->withCachedFile(40_000_000);
		$this->sidecar->method('fetchSoundFontInfo')
			->willReturn(['available' => true, 'version' => 'neu456']);
		$this->config->method('getAppValue')->willReturn('alt123');
		$this->tempManager->method('getTemporaryFile')->willReturn('');
		$this->sidecar->expects($this->once())->method('downloadSoundFontTo');

		// Der Download schreibt hier nichts (leerer Pfad), der Dienst muss das
		// als leere Datei erkennen und melden statt sie als gueltig zu fuehren.
		$this->expectException(SidecarException::class);
		$this->expectExceptionMessageMatches('/leere Datei/');
		$this->service()->getOrFetch();
	}

	public function testBehandeltEineLeereCachedateiAlsNichtVorhanden(): void {
		// Ein abgebrochener Download hinterlaesst sonst eine 0-Byte-Datei, die
		// den Synthesizer stumm laesst, ohne dass die Ursache erkennbar waere.
		$this->withCachedFile(0);
		$this->sidecar->method('fetchSoundFontInfo')
			->willThrowException(new SidecarException('Verbindung abgelehnt'));

		$this->expectException(SidecarException::class);
		$this->service()->getOrFetch();
	}

	public function testSchreibtDieVersionErstNachErfolgreichemSchreiben(): void {
		// Bricht der Download ab, muss die alte Version stehenbleiben, damit
		// der naechste Aufruf es erneut versucht - sonst gaelte eine halbe
		// Datei als aktuell.
		$this->withoutCache();
		$this->sidecar->method('fetchSoundFontInfo')
			->willReturn(['available' => true, 'version' => 'neu456']);
		$this->tempManager->method('getTemporaryFile')->willReturn('');
		$this->config->expects($this->never())->method('setAppValue');

		$this->expectException(SidecarException::class);
		$this->service()->getOrFetch();
	}
}
