<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\ConverterException;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\SoundFontService;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\IAppConfig;
use OCP\ITempManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * getOrFetch() traegt die Zusage, dass Wiedergabe den Sidecar NICHT
 * braucht - nur die Konvertierung. Das haengt allein an den
 * Rueckfallpfaden hier, und die sind von aussen nur als "es kommt Ton" bzw.
 * "es kommt keiner" sichtbar. Genau die Sorte Logik, die ein Refactoring
 * still umdreht.
 */
class SoundFontServiceTest extends TestCase {
	private IAppData&MockObject $appData;
	private SidecarClient&MockObject $sidecar;
	private IAppConfig&MockObject $appConfig;
	private ITempManager&MockObject $tempManager;
	private IClientService&MockObject $clientService;

	protected function setUp(): void {
		$this->appData = $this->createMock(IAppData::class);
		$this->sidecar = $this->createMock(SidecarClient::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->tempManager = $this->createMock(ITempManager::class);
		$this->clientService = $this->createMock(IClientService::class);
	}

	private function service(): SoundFontService {
		return new SoundFontService($this->appData, $this->sidecar, $this->appConfig, $this->tempManager, $this->clientService);
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

	/**
	 * Antwortet je Schluessel statt pauschal. Noetig, seit der Dienst zwei
	 * Einstellungen liest (Cache-Version und `soundfont_fetch_url`): ein
	 * pauschales willReturn() haette die URL-Quelle eingeschaltet und damit
	 * genau den Sidecar-Pfad umgangen, den diese Tests pruefen.
	 *
	 * @param array<string, string> $values
	 */
	private function withConfig(array $values): void {
		$this->appConfig->method('getValueString')
			->willReturnCallback(static fn (string $app, string $key, string $default = '') => $values[$key] ?? $default);
	}

	public function testLiefertCacheWennSidecarNichtErreichbarIst(): void {
		// Der eigentliche Punkt: eine Probe darf nicht
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
		$this->withConfig(['soundfont_cache_version' => 'abc123']);
		$this->sidecar->expects($this->never())->method('downloadSoundFontTo');

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testLaedtNeuWennDasImageEinAnderesSoundFontMitbringt(): void {
		// Content-Hash als Cache-Schluessel: ein SoundFont-Wechsel im Image
		// invalidiert Server- und Browser-Cache automatisch.
		$this->withCachedFile(40_000_000);
		$this->sidecar->method('fetchSoundFontInfo')
			->willReturn(['available' => true, 'version' => 'neu456']);
		$this->withConfig(['soundfont_cache_version' => 'alt123']);
		$this->tempManager->method('getTemporaryFile')->willReturn('');
		$this->sidecar->expects($this->once())->method('downloadSoundFontTo');

		// Der Download schreibt hier nichts (leerer Pfad), der Dienst muss das
		// als leere Datei erkennen und melden statt sie als gueltig zu fuehren.
		$this->expectException(SidecarException::class);
		$this->expectExceptionMessageMatches('/leere Datei/');
		$this->service()->getOrFetch();
	}

	public function testHoltVonDerKonfiguriertenUrlStattVomSidecar(): void {
		// Der Weg zu Ton ohne Sidecar (docs/architecture.md E3): liegt die
		// Datei schon im Cache und passt die Version zur URL, darf weder
		// heruntergeladen noch der Sidecar gefragt werden.
		$cached = $this->withCachedFile(40_000_000);
		$url = 'https://example.invalid/FluidR3Mono_GM.sf3';
		$this->withConfig([
			'soundfont_fetch_url' => $url,
			'soundfont_cache_version' => 'url:' . substr(sha1($url), 0, 12),
		]);
		$this->sidecar->expects($this->never())->method('fetchSoundFontInfo');
		$this->clientService->expects($this->never())->method('newClient');

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testLiefertDenCacheWennDerDownloadScheitert(): void {
		// Dieselbe Zusage wie beim Sidecar-Ausfall: ein nicht erreichbarer
		// Hoster darf eine laufende Probe nicht verstummen lassen.
		$cached = $this->withCachedFile(40_000_000);
		$this->withConfig([
			'soundfont_fetch_url' => 'https://example.invalid/sf3',
			'soundfont_cache_version' => 'url:veraltet',
		]);
		$client = $this->createMock(IClient::class);
		$client->method('get')->willThrowException(new \RuntimeException('Name oder Dienst nicht bekannt'));
		$this->clientService->method('newClient')->willReturn($client);

		$this->assertSame($cached, $this->service()->getOrFetch());
	}

	public function testMeldetEinenGescheitertenDownloadOhneCache(): void {
		$this->withoutCache();
		$this->withConfig(['soundfont_fetch_url' => 'https://example.invalid/sf3']);
		$client = $this->createMock(IClient::class);
		$client->method('get')->willThrowException(new \RuntimeException('Name oder Dienst nicht bekannt'));
		$this->clientService->method('newClient')->willReturn($client);

		$this->expectException(ConverterException::class);
		$this->expectExceptionMessageMatches('/example.invalid/');
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
		$this->appConfig->expects($this->never())->method('setValueString');

		$this->expectException(SidecarException::class);
		$this->service()->getOrFetch();
	}
}
