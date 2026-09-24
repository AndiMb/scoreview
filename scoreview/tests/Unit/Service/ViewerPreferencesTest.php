<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\IConfig;
use PHPUnit\Framework\TestCase;

/**
 * Die gespeicherte Farbe landet im Viewer als CSS-Wert und der Modus als
 * Verzweigung. Beide kommen aus einem POST - was hier durchrutscht, steht
 * spaeter in einem `style`-Attribut oder erzeugt einen dritten, nirgends
 * behandelten Zustand.
 */
class ViewerPreferencesTest extends TestCase {
	public function testNimmtNurEineEchteHexFarbe(): void {
		$this->assertSame('#ab12ef', ViewerPreferences::normalizeColor('#AB12EF'));
		// Kurzform ausschreiben statt ablehnen - `occ` setzt so etwas von Hand.
		$this->assertSame('#aabbcc', ViewerPreferences::normalizeColor('#abc'));
		$this->assertSame(ViewerPreferences::DEFAULT_COLOR, ViewerPreferences::normalizeColor('red'));
		$this->assertSame(ViewerPreferences::DEFAULT_COLOR, ViewerPreferences::normalizeColor('#12345'));
		// Der Fall, um den es wirklich geht: nichts, was aus dem Wert
		// ausbrechen und eigene CSS-Deklarationen anhaengen koennte.
		$this->assertSame(ViewerPreferences::DEFAULT_COLOR, ViewerPreferences::normalizeColor('#fff;background:url(x)'));
	}

	public function testKenntNurDieBeidenModi(): void {
		$this->assertSame(ViewerPreferences::MODE_BAR, ViewerPreferences::normalizeMode('bar'));
		$this->assertSame(ViewerPreferences::MODE_NOTES, ViewerPreferences::normalizeMode('notes'));
		$this->assertSame(ViewerPreferences::MODE_NOTES, ViewerPreferences::normalizeMode('irgendwas'));
	}

	public function testLiefertOhneAngemeldeteNutzerinDieVorgaben(): void {
		// Der Anfangszustand haengt an der Files-Seite; ohne Sitzung soll das
		// eine Vorgabe sein und kein Fehler.
		$config = $this->createMock(IConfig::class);
		$config->expects($this->never())->method('getUserValue');
		$preferences = new ViewerPreferences($config);

		$this->assertSame($preferences->defaults(), $preferences->get(null));
	}

	public function testSpeichertNormalisiertUndAntwortetMitDemGespeicherten(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->exactly(2))->method('setUserValue')
			->willReturnCallback(function (string $userId, string $app, string $key, string $value): void {
				$this->assertSame('anna', $userId);
				$this->assertSame(Application::APP_ID, $app);
				$this->assertSame(
					$key === ViewerPreferences::KEY_HIGHLIGHT_COLOR ? '#00ff00' : ViewerPreferences::MODE_BAR,
					$value,
				);
			});
		$preferences = new ViewerPreferences($config);

		$this->assertSame(
			['highlightColor' => '#00ff00', 'highlightMode' => ViewerPreferences::MODE_BAR],
			$preferences->set('anna', '#00FF00', 'bar'),
		);
	}
	// --- Stereobild und Dunkelmodus ----------------------------------------

	public function testKenntNurDieDreiNotenThemes(): void {
		$this->assertSame('dark', ViewerPreferences::normalizeTheme('dark'));
		$this->assertSame('light', ViewerPreferences::normalizeTheme(' light '));
		$this->assertSame('auto', ViewerPreferences::normalizeTheme('auto'));
		$this->assertSame('auto', ViewerPreferences::normalizeTheme('sepia'));
	}

	public function testLiestStereobildUndDunkelmodusMitVorgaben(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnCallback(
			fn (string $user, string $app, string $key, string $default): string => match ($key) {
				ViewerPreferences::KEY_STEREO_MY_PART => '1',
				ViewerPreferences::KEY_NOTE_THEME => 'kaputt',
				default => $default,
			},
		);
		$werte = (new ViewerPreferences($config))->get('anna');

		$this->assertTrue($werte['stereoMyPart']);
		$this->assertSame('auto', $werte['noteTheme']);
		$this->assertSame(ViewerPreferences::DEFAULT_COLOR, $werte['highlightColor']);
	}

	/**
	 * Das Stereobild ist aus, solange niemand es einschaltet - auch
	 * ohne Sitzung (Anfangszustand einer fremden Seite).
	 */
	public function testStereobildIstVoreingestelltAus(): void {
		$preferences = new ViewerPreferences($this->createMock(IConfig::class));
		$this->assertFalse($preferences->defaults()['stereoMyPart']);
		$this->assertSame('auto', $preferences->defaults()['noteTheme']);
	}

	public function testSpeichertNurMitgeschickteAnzeigewerte(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->once())->method('setUserValue')
			->with('anna', Application::APP_ID, ViewerPreferences::KEY_NOTE_THEME, 'light');
		$preferences = new ViewerPreferences($config);

		$this->assertSame(['noteTheme' => 'light'], $preferences->setDisplay('anna', null, 'light'));
	}

	// --- Meine Stimme je Partitur ------------------------------------------

	public function testSpeichertMeineStimmeJeDatei(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->once())->method('setUserValue')
			->with('anna', Application::APP_ID, 'my_part.42', '3');
		$preferences = new ViewerPreferences($config);

		$this->assertSame('3', $preferences->setMyPart('anna', 42, ' 3 '));
	}

	/**
	 * „Keine Stimme" loescht den Eintrag, statt fuer jede je geoeffnete
	 * Partitur einen leeren Wert liegen zu lassen.
	 */
	public function testKeineStimmeLoeschtDenEintrag(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->never())->method('setUserValue');
		$config->expects($this->exactly(2))->method('deleteUserValue')
			->with('anna', Application::APP_ID, 'my_part.42');
		$preferences = new ViewerPreferences($config);

		$this->assertNull($preferences->setMyPart('anna', 42, null));
		$this->assertNull($preferences->setMyPart('anna', 42, '   '));
	}

	public function testLiestMeineStimmeUndVerwirftUnbrauchbares(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnMap([
			['anna', Application::APP_ID, 'my_part.1', '', 'Tenor-1'],
			['anna', Application::APP_ID, 'my_part.2', '', ''],
			['anna', Application::APP_ID, 'my_part.3', '', str_repeat('x', 65)],
		]);
		$preferences = new ViewerPreferences($config);

		$this->assertSame('Tenor-1', $preferences->getMyPart('anna', 1));
		$this->assertNull($preferences->getMyPart('anna', 2));
		$this->assertNull($preferences->getMyPart('anna', 3), 'zu lang');
	}

	public function testNimmtKeineSteuerzeichenInDieStimmenId(): void {
		$this->assertNull(ViewerPreferences::normalizePartId("1\n2"));
		$this->assertSame(str_repeat('x', 64), ViewerPreferences::normalizePartId(str_repeat('x', 64)));
	}
}
