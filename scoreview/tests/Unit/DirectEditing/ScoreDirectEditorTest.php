<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\DirectEditing;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\DirectEditing\ScoreDirectEditor;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http\FeaturePolicy;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\DirectEditing\IToken;
use OCP\Files\File;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Was dieser Editor der mobilen App verspricht, entscheidet darueber, wofuer
 * sie „Bearbeiten" anbietet - und zwar instanzweit, nicht nur fuer
 * Partituren. Deshalb sind hier vor allem die beiden LEEREN Listen wichtig:
 * ein optionaler Mimetype zu viel, und die App boete ScoreView fuer jede
 * unbekannte Datei an.
 */
class ScoreDirectEditorTest extends TestCase {
	private IInitialState&MockObject $initialState;
	private IRequest&MockObject $request;
	private ViewerPreferences&MockObject $preferences;
	private FeatureConfig&MockObject $features;

	protected function setUp(): void {
		$this->initialState = $this->createMock(IInitialState::class);
		$this->request = $this->createMock(IRequest::class);
		$this->preferences = $this->createMock(ViewerPreferences::class);
		$this->preferences->method('get')
			->willReturn(['highlightColor' => '#ff0000', 'highlightMode' => 'note']);
		$this->features = $this->createMock(FeatureConfig::class);
		$this->features->method('forViewer')->willReturn(['followSession' => false, 'followPollMs' => 800]);
	}

	private function editor(): ScoreDirectEditor {
		return new ScoreDirectEditor(
			$this->initialState, $this->request, $this->preferences, $this->features);
	}

	public function testMeldetGenauDenPartiturMimetype(): void {
		$this->assertSame([Application::MSCZ_MIMETYPE], $this->editor()->getMimetypes());
	}

	/**
	 * `application/octet-stream` waere hier technisch wirksam - auf einer
	 * Instanz ohne Mimetype-Registrierung stehen .mscz-Dateien genau darauf -
	 * und fachlich falsch: Die App zieht optionale Mimetypes gleichberechtigt
	 * heran (nachgesehen in nextcloud/android, EditorUtils).
	 */
	public function testBietetKeineOptionalenMimetypesAn(): void {
		$this->assertSame([], $this->editor()->getMimetypesOptional());
	}

	/** Ein Creator erschiene im „+"-Menue der App als Eintrag, der nirgendwohin fuehrt. */
	public function testBietetKeineVorlagenAn(): void {
		$this->assertSame([], $this->editor()->getCreators());
		$this->assertFalse($this->editor()->isSecure());
		$this->assertSame(Application::APP_ID, $this->editor()->getId());
	}

	public function testOeffnenLiefertSeiteMitDateiUndToken(): void {
		$token = $this->tokenFuerDatei(42, 'Choral.mscz');
		// Der Token kommt aus dem URL-Parameter der Route, nicht aus
		// IToken::getToken() - die Methode gibt es erst ab Nextcloud 35.
		$this->request->method('getParam')->with('token', '')->willReturn('abc123');

		$geliefert = [];
		$this->initialState->method('provideInitialState')
			->willReturnCallback(function (string $schluessel, $wert) use (&$geliefert): void {
				$geliefert[$schluessel] = $wert;
			});

		$antwort = $this->editor()->open($token);

		$this->assertInstanceOf(TemplateResponse::class, $antwort);
		$this->assertSame(42, $geliefert['standalone']['fileId']);
		$this->assertSame('Choral.mscz', $geliefert['standalone']['fileName']);
		$this->assertSame('abc123', $geliefert['standalone']['token']);
		// Woran die Seite sich selbst erkennt - etwa fuer den Setlisten-Editor
		// ohne Nextclouds Dateiauswahl (components/SetlistEditor.vue).
		$this->assertTrue($geliefert['standalone']['directEditing']);
	}

	/**
	 * S3: Das Mikrofon gibt die Seite nur frei, wenn eine Mikrofonfunktion
	 * eingeschaltet ist - und zwar als FeaturePolicy, die Nextcloud mit der
	 * Vorgabe zusammenfuehrt, nicht als EmptyFeaturePolicy, die sie ersetzte.
	 */
	public function testMikrofonNurWennEineFunktionEsBraucht(): void {
		$this->request->method('getParam')->willReturn('t');
		foreach ([false, true] as $braucht) {
			$this->features = $this->createMock(FeatureConfig::class);
			$this->features->method('forViewer')->willReturn([]);
			$this->features->method('usesMicrophone')->willReturn($braucht);

			$antwort = $this->editor()->open($this->tokenFuerDatei(7, 'x.mscz'));

			$richtlinie = $antwort->getFeaturePolicy();
			$this->assertSame(FeaturePolicy::class, get_class($richtlinie));
			if (!$braucht) {
				$this->assertStringContainsString("microphone 'none'", $richtlinie->buildPolicy(), 'ohne Funktion bleibt es bei der Vorgabe');
				continue;
			}
			$this->assertStringContainsString("microphone 'self'", $richtlinie->buildPolicy());
			$this->assertStringContainsString("fullscreen 'self'", $richtlinie->buildPolicy(), 'Vorgabe bleibt');
		}
	}

	/**
	 * Ohne die Einstellungen im Initial State leuchtete die Partitur beim
	 * Oeffnen einen Moment in der Vorgabefarbe auf - derselbe Grund, aus dem
	 * sie auf der Dateien-Seite schon dort stehen. Der Nutzername kommt aus
	 * dem Token: Eine Sitzung gibt es auf dieser Seite nicht.
	 */
	public function testLiefertDieAnzeigeeinstellungenDerNutzerinMit(): void {
		$token = $this->tokenFuerDatei(7, 'x.mscz');
		$token->method('getUser')->willReturn('Andreas');
		$this->request->method('getParam')->willReturn('t');

		$this->preferences = $this->createMock(ViewerPreferences::class);
		$this->preferences->expects($this->once())->method('get')->with('Andreas')
			->willReturn(['highlightColor' => '#00ff00', 'highlightMode' => 'measure']);

		$geliefert = [];
		$this->initialState->method('provideInitialState')
			->willReturnCallback(function (string $schluessel, $wert) use (&$geliefert): void {
				$geliefert[$schluessel] = $wert;
			});

		$this->editor()->open($token);

		$this->assertSame('#00ff00', $geliefert['viewer-preferences']['highlightColor']);
	}

	/**
	 * Eine abgeschaltete Funktion darf in der App nicht auftauchen, nur weil
	 * der Einstieg ein anderer ist als die Files-Seite.
	 */
	public function testLiefertDieSchalterDerAdministrationMit(): void {
		$token = $this->tokenFuerDatei(7, 'x.mscz');
		$this->request->method('getParam')->willReturn('t');

		$geliefert = [];
		$this->initialState->method('provideInitialState')
			->willReturnCallback(function (string $schluessel, $wert) use (&$geliefert): void {
				$geliefert[$schluessel] = $wert;
			});

		$this->editor()->open($token);

		$this->assertSame(['followSession' => false, 'followPollMs' => 800], $geliefert['features']);
	}

	/**
	 * Der Token-Scope ist der einzige Grund, warum getFile() ueberhaupt etwas
	 * finden kann - ohne ihn laeuft der Request ohne Nutzerin.
	 */
	public function testNutztDenTokenScope(): void {
		$token = $this->tokenFuerDatei(1, 'x.mscz');
		$token->expects($this->once())->method('useTokenScope');
		$this->request->method('getParam')->willReturn('t');

		$this->editor()->open($token);
	}

	/** Keine Datei, keine Seite - und schon gar kein 500er. */
	public function testOhneDateiEineVierNullVier(): void {
		$token = $this->createMock(IToken::class);
		$token->method('getFile')->willThrowException(new \RuntimeException('weg'));

		$this->assertInstanceOf(NotFoundResponse::class, $this->editor()->open($token));
	}

	private function tokenFuerDatei(int $fileId, string $name): IToken&MockObject {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($fileId);
		$file->method('getName')->willReturn($name);

		$token = $this->createMock(IToken::class);
		$token->method('getFile')->willReturn($file);
		return $token;
	}
}
