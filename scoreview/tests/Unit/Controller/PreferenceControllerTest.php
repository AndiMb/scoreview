<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Controller\PreferenceController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http;
use OCP\IConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;

/**
 * Die Anzeigeeinstellungen gehen durch den echten ViewerPreferences-Dienst
 * (nur IConfig ist gemockt): Getestet wird, was am Ende in den
 * Nutzereinstellungen steht, nicht, dass eine Methode gerufen wurde.
 *
 * Zwei Zusagen neben dem Normalfall:
 *
 * 1. **Nur die eigene Einstellung**: Die Nutzerkennung kommt aus der
 *    Sitzung; ohne Sitzung gibt es 401 und keinen Schreibzugriff.
 * 2. **Was nicht mitkommt, bleibt stehen**: Stereobild und Dunkelmodus kamen
 *    spaeter dazu. Ein Viewer mit aelterem Bundle im Cache schickt sie nicht
 *    und darf sie dann nicht auf die Vorgabe zuruecksetzen.
 */
class PreferenceControllerTest extends TestCase {
	/** @var array<string, string> Schluessel -> gespeicherter Wert */
	private array $gespeichert = [];

	private function controller(?string $userId): PreferenceController {
		$config = $this->createMock(IConfig::class);
		$config->method('setUserValue')
			->willReturnCallback(function (string $user, string $app, string $key, string $value): void {
				$this->assertSame('anna', $user);
				$this->assertSame(Application::APP_ID, $app);
				$this->gespeichert[$key] = $value;
			});

		$session = $this->createMock(IUserSession::class);
		if ($userId === null) {
			$session->method('getUser')->willReturn(null);
		} else {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($userId);
			$session->method('getUser')->willReturn($user);
		}
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);

		return new PreferenceController(
			$this->createMock(IRequest::class),
			$session,
			new ViewerPreferences($config),
			$l,
		);
	}

	public function testSpeichertStereobildUndDunkelmodus(): void {
		$antwort = $this->controller('anna')->update('#00ff00', 'bar', true, 'dark');

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$this->assertSame([
			'highlightColor' => '#00ff00',
			'highlightMode' => 'bar',
			'stereoMyPart' => true,
			'noteTheme' => 'dark',
		], $antwort->getData());
		$this->assertSame('1', $this->gespeichert[ViewerPreferences::KEY_STEREO_MY_PART]);
		$this->assertSame('dark', $this->gespeichert[ViewerPreferences::KEY_NOTE_THEME]);
	}

	public function testNormalisiertEinenUnbekanntenDunkelmodus(): void {
		$antwort = $this->controller('anna')->update('#00ff00', 'notes', false, 'sepia;x');

		$this->assertSame('auto', $antwort->getData()['noteTheme']);
		$this->assertSame('0', $this->gespeichert[ViewerPreferences::KEY_STEREO_MY_PART]);
		$this->assertSame('auto', $this->gespeichert[ViewerPreferences::KEY_NOTE_THEME]);
	}

	public function testLaesstNichtMitgeschickteWerteStehen(): void {
		$antwort = $this->controller('anna')->update('#00ff00', 'notes');

		$this->assertArrayNotHasKey('stereoMyPart', $antwort->getData());
		$this->assertArrayNotHasKey('noteTheme', $antwort->getData());
		$this->assertArrayNotHasKey(ViewerPreferences::KEY_STEREO_MY_PART, $this->gespeichert);
		$this->assertArrayNotHasKey(ViewerPreferences::KEY_NOTE_THEME, $this->gespeichert);
	}

	public function testOhneSitzungKeinSchreibzugriff(): void {
		$antwort = $this->controller(null)->update('#00ff00', 'bar', true, 'dark');

		$this->assertSame(Http::STATUS_UNAUTHORIZED, $antwort->getStatus());
		$this->assertSame([], $this->gespeichert);
	}

	/**
	 * E8: Auch die mobile Seite speichert - mit ihrem Direct-Editing-Token,
	 * nie mit einem Begleit-Token, und im Sitzungsfall mit der CSRF-Pruefung,
	 * die die Route vorher hatte.
	 */
	public function testNimmtDasDirectEditingTokenAn(): void {
		$attribute = (new \ReflectionMethod(PreferenceController::class, 'update'))->getAttributes(DirectTokenOrSession::class);
		$this->assertCount(1, $attribute);
		$attribut = $attribute[0]->newInstance();
		$this->assertNull($attribut->companion);
		$this->assertTrue($attribut->csrfInSession);
		$this->assertFalse($attribut->directOnly);
	}
}
