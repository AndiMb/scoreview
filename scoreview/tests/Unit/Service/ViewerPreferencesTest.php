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
}
