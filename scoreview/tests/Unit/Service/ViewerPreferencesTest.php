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

	public function testUebeEinstellungenHabenVorgabenOhneEintrag(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('');
		$this->assertSame(['transpose' => 0, 'coach' => false, 'othersLevel' => 40, 'source' => 'full', 'concert' => false, 'transposeNotation' => false], (new ViewerPreferences($config))->getPractice('anna', 7));
	}

	public function testUebeEinstellungenWerdenBegrenzt(): void {
		$this->assertSame(
			['transpose' => -12, 'coach' => false, 'othersLevel' => 127, 'source' => 'full', 'concert' => false, 'transposeNotation' => false],
			ViewerPreferences::normalizePractice(['transpose' => -40, 'coach' => 'ja', 'othersLevel' => 999]),
		);
	}

	public function testSpeichertNurMitgeschickteUebeWerte(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('{"transpose":-2,"coach":true,"othersLevel":30}');
		$config->expects($this->once())->method('setUserValue')
			->with('anna', 'scoreview', 'practice.7', '{"transpose":-2,"coach":true,"othersLevel":60,"source":"full","concert":false,"transposeNotation":false}');
		$werte = (new ViewerPreferences($config))->setPractice('anna', 7, null, null, 60);
		$this->assertSame(['transpose' => -2, 'coach' => true, 'othersLevel' => 60, 'source' => 'full', 'concert' => false, 'transposeNotation' => false], $werte);
	}

	public function testLoeschtDenEintragBeiLauterVorgaben(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('{"transpose":3}');
		$config->expects($this->never())->method('setUserValue');
		$config->expects($this->once())->method('deleteUserValue')->with('anna', 'scoreview', 'practice.7');
		(new ViewerPreferences($config))->setPractice('anna', 7, 0, null, null);
	}

	public function testUnlesbarerUebeEintragGiltAlsVorgabe(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('{kaputt');
		$this->assertSame(0, (new ViewerPreferences($config))->getPractice('anna', 7)['transpose']);
	}

	public function testTonnamenUndDarstellungNurMitgeschickt(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->exactly(2))->method('setUserValue');
		$werte = (new ViewerPreferences($config))->setViewing('anna', 'solfa-movable', null, 'karaoke', null);
		// Unbekannte Darstellung faellt auf Seiten zurueck, statt gespeichert zu werden.
		$this->assertSame(['noteNames' => 'solfa-movable', 'layout' => 'pages'], $werte);
	}

	public function testTonnamenVorgabenOhneEintrag(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnArgument(3);
		$werte = (new ViewerPreferences($config))->get('anna');
		$this->assertSame(['off', true, 'pages', false], [$werte['noteNames'], $werte['noteNamesMine'], $werte['layout'], $werte['bandOffered']]);
	}

	public function testScrollsAlongByDefault(): void {
		// Without an entry the viewer behaves as it always did.
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnArgument(3);
		$preferences = new ViewerPreferences($config);
		$this->assertTrue($preferences->get('anna')['autoScroll']);
		$this->assertTrue($preferences->defaults()['autoScroll']);
	}

	public function testStoresAutoScrollOnlyWhenSent(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->once())->method('setUserValue')
			->with('anna', Application::APP_ID, ViewerPreferences::KEY_AUTO_SCROLL, '0');
		$preferences = new ViewerPreferences($config);
		$this->assertSame(['autoScroll' => false], $preferences->setViewing('anna', null, null, null, null, false));
		// An older bundle does not send it - and must not reset it.
		$this->assertSame([], $preferences->setViewing('anna', null, null, null, null));
	}

	public function testReferencePitchIsClampedToWholeHz(): void {
		$this->assertSame(442, ViewerPreferences::normalizeReferencePitch('442'));
		$this->assertSame(443, ViewerPreferences::normalizeReferencePitch(442.6));
		// Within the synthesizer's ±100 cents, not rejected.
		$this->assertSame(420, ViewerPreferences::normalizeReferencePitch(415));
		$this->assertSame(460, ViewerPreferences::normalizeReferencePitch('9999'));
		$this->assertSame(440, ViewerPreferences::normalizeReferencePitch('a'));
		$this->assertSame(440, ViewerPreferences::normalizeReferencePitch(''));
	}

	public function testReferencePitchDefaultsTo440(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnArgument(3);
		$preferences = new ViewerPreferences($config);
		$this->assertSame(440, $preferences->get('anna')['referencePitch']);
		$this->assertSame(440, $preferences->defaults()['referencePitch']);
	}

	public function testStoresReferencePitchOnlyWhenSent(): void {
		$config = $this->createMock(IConfig::class);
		$config->expects($this->once())->method('setUserValue')
			->with('anna', Application::APP_ID, ViewerPreferences::KEY_REFERENCE_PITCH, '443');
		$preferences = new ViewerPreferences($config);
		$this->assertSame(['referencePitch' => 443], $preferences->setReferencePitch('anna', 443.0));
		$this->assertSame([], $preferences->setReferencePitch('anna', null));
	}

	public function testReadsSwitchedOffAutoScroll(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnCallback(
			fn (string $u, string $a, string $key, string $default): string => $key === ViewerPreferences::KEY_AUTO_SCROLL ? '0' : $default,
		);
		$this->assertFalse((new ViewerPreferences($config))->get('anna')['autoScroll']);
	}

	public function testRemembersTheDisplayVariantAndRefusesWhatIsNoSource(): void {
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturn('');
		$prefs = new ViewerPreferences($config);
		$this->assertSame('ex1', $prefs->setPractice('anna', 7, null, null, null, 'ex1', true, true)['source']);
		$this->assertSame('part3', ViewerPreferences::normalizePractice(['source' => 'part3'])['source']);
		$this->assertSame('full', ViewerPreferences::normalizePractice(['source' => 'part../x'])['source']);
		$this->assertSame('full', ViewerPreferences::normalizePractice(['source' => 'ex01'])['source']);
		$this->assertSame('full', ViewerPreferences::normalizePractice(['source' => 7])['source']);
		$this->assertTrue(ViewerPreferences::normalizePractice(['concert' => true, 'transposeNotation' => true])['transposeNotation']);
	}
}
