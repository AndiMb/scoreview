<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\AnnotationController;
use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Service\AnnotationService;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\Constants;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Was dieser Controller allein entscheidet - AnnotationService bekommt die
 * fertige Rechteentscheidung uebergeben und kann sie deshalb nicht pruefen.
 *
 * Drei Zusagen:
 *
 * 1. **Eine geteilte Notiz braucht Schreibrecht an der Datei.** „Geteilt"
 *    heisst fuer jede Person mit Dateizugriff sichtbar - wer die Partitur nur
 *    geliehen hat, soll dort nichts hinterlassen koennen.
 * 2. **Ein unbekannter Sichtbarkeitswert wird `private`, nie `shared`.** Ein
 *    Tippfehler im Client darf nicht versehentlich veroeffentlichen.
 * 3. **Jedes frei bestimmbare Feld wird geprueft, bevor es in die Datenbank
 *    geht.** Text, Sichtbarkeit, Taktnummer, Bruchteil - und seit dieser
 *    Runde auch der Anker-etag, der als einziger ungeprueft in eine
 *    VARCHAR(64)-Spalte lief.
 */
class AnnotationControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private AnnotationService&MockObject $annotationService;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->annotationService = $this->createMock(AnnotationService::class);
	}

	private function controller(): AnnotationController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new AnnotationController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->annotationService,
			$this->createMock(ConversionService::class),
			$l,
		);
	}

	/**
	 * @param int $permissions Dateirechte aus Sicht der anfragenden Nutzerin
	 */
	private function angemeldetMitDatei(int $permissions = Constants::PERMISSION_ALL): void {
		$node = $this->createMock(Node::class);
		$node->method('getId')->willReturn(42);
		$node->method('getEtag')->willReturn('etag1');
		$node->method('getPermissions')->willReturn($permissions);
		$this->fileResolver->method('resolveOwnNode')->willReturn($node);
		$this->fileResolver->method('currentUserId')->willReturn('andreas');
	}

	// --- Zusage 1: Schreibrecht fuer Geteiltes -----------------------------

	public function testEineGeteilteNotizBrauchtSchreibrecht(): void {
		$this->angemeldetMitDatei(Constants::PERMISSION_READ);
		$this->annotationService->expects($this->never())->method('create');

		$response = $this->controller()->create(
			42, 1, 0.0, 'Hier Luft holen', null, null, Annotation::VISIBILITY_SHARED);

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	public function testMitSchreibrechtDarfGeteiltAngelegtWerden(): void {
		$this->angemeldetMitDatei(Constants::PERMISSION_ALL);
		$this->annotationService->expects($this->once())
			->method('create')
			->with(42, 'andreas', 1, 0.0, null, null, 'Hier Luft holen', Annotation::VISIBILITY_SHARED)
			->willReturn(new Annotation());

		$response = $this->controller()->create(
			42, 1, 0.0, 'Hier Luft holen', null, null, Annotation::VISIBILITY_SHARED);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
	}

	// --- Zusage 2: Sichtbarkeit ist eine feste Wertemenge -------------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function unbekannteSichtbarkeiten(): array {
		return [
			'Tippfehler' => ['shraed'],
			'Grossschreibung' => ['SHARED'],
			'leer' => [''],
			'ganz anderes' => ['public'],
		];
	}

	/**
	 * Wichtig ist nicht nur, dass ein unbekannter Wert abgelehnt wird -
	 * sondern dass er auf die ENGERE Sichtbarkeit faellt. Ein Tippfehler darf
	 * nie zu „sehen alle" fuehren.
	 */
	#[DataProvider('unbekannteSichtbarkeiten')]
	public function testEineUnbekannteSichtbarkeitWirdPrivat(string $visibility): void {
		// Ohne Schreibrecht - laege der Tippfehler faelschlich auf 'shared',
		// endete der Aufruf in einem 403 statt in einer privaten Notiz.
		$this->angemeldetMitDatei(Constants::PERMISSION_READ);
		$this->annotationService->expects($this->once())
			->method('create')
			->with(42, 'andreas', 1, 0.0, null, null, 'Notiz', Annotation::VISIBILITY_PRIVATE)
			->willReturn(new Annotation());

		$response = $this->controller()->create(42, 1, 0.0, 'Notiz', null, null, $visibility);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
	}

	// --- Zusage 3: geprueft, bevor es in die Datenbank geht ----------------

	/**
	 * @return array<string, array{string}>
	 */
	public static function unguelteTexte(): array {
		return [
			'leer' => [''],
			'nur Leerraum' => ["  \n\t "],
			'zu lang' => [str_repeat('a', 10001)],
		];
	}

	#[DataProvider('unguelteTexte')]
	public function testEinUnguelterTextEndetAls400(string $content): void {
		$this->angemeldetMitDatei();
		$this->annotationService->expects($this->never())->method('create');

		$response = $this->controller()->create(42, 1, 0.0, $content);

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}

	/**
	 * Die Spalte ist VARCHAR(64). Vorher lief ein laengerer Wert ungeprueft
	 * bis zur Datenbank und endete dort im Strict-Mode als 500er.
	 */
	public function testEinZuLangerAnkerEtagEndetAls400(): void {
		$this->angemeldetMitDatei();
		$this->annotationService->expects($this->never())->method('create');

		$response = $this->controller()->create(
			42, 1, 0.0, 'Notiz', null, str_repeat('a', 65));

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}

	public function testEinRegulaererAnkerEtagGehtDurch(): void {
		$this->angemeldetMitDatei();
		$this->annotationService->expects($this->once())->method('create')->willReturn(new Annotation());

		$response = $this->controller()->create(
			42, 1, 0.0, 'Notiz', null, str_repeat('a', 64));

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
	}

	/**
	 * Takte zaehlen ab 1, der Bruchteil liegt im Takt. Ein Anker ausserhalb
	 * waere keine sichtbare Notiz, sondern eine unauffindbare.
	 *
	 * Nach OBEN wird die Taktnummer bewusst nicht begrenzt - ein Re-Upload
	 * kann Takte entfernt haben, und das wird als `orphaned` angezeigt statt
	 * verworfen (AnnotationService::serialize).
	 *
	 * @return array<string, array{int, float, int, float}>
	 */
	public static function ankerRaender(): array {
		return [
			'Takt null' => [0, 0.5, 1, 0.5],
			'Takt negativ' => [-7, 0.5, 1, 0.5],
			'Bruchteil ueber eins' => [3, 1.5, 3, 1.0],
			'Bruchteil negativ' => [3, -0.5, 3, 0.0],
			'Bruchteil unendlich' => [3, INF, 3, 0.0],
			'Bruchteil keine Zahl' => [3, NAN, 3, 0.0],
			'weit hinten bleibt' => [9999, 0.25, 9999, 0.25],
		];
	}

	#[DataProvider('ankerRaender')]
	public function testDerAnkerWirdInDenGueltigenBereichGezwungen(
		int $takt, float $bruchteil, int $erwarteterTakt, float $erwarteterBruchteil,
	): void {
		$this->angemeldetMitDatei();
		$this->annotationService->expects($this->once())
			->method('create')
			->with(42, 'andreas', $erwarteterTakt, $erwarteterBruchteil)
			->willReturn(new Annotation());

		$this->controller()->create(42, $takt, $bruchteil, 'Notiz');
	}

	// --- Fremde Notizen ----------------------------------------------------

	/**
	 * Eine private Notiz einer anderen Nutzerin endet als 404, nicht als 403 -
	 * bewusst ohne ihre Existenz zu bestaetigen. Bei einer GETEILTEN Notiz
	 * ohne Schreibrecht ist das anders (403): die ist fuer jeden mit
	 * Dateizugriff ohnehin sichtbar, da gibt es nichts zu verbergen.
	 */
	public function testEineFremdePrivateNotizEndetAls404(): void {
		$this->angemeldetMitDatei();
		$this->annotationService->method('updateContent')->willReturn(null);

		$response = $this->controller()->update(42, 7, 'Neuer Text');

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	public function testEineGeteilteNotizOhneSchreibrechtEndetAls403(): void {
		$this->angemeldetMitDatei(Constants::PERMISSION_READ);
		$this->annotationService->method('updateContent')
			->willThrowException(new \RuntimeException('Kein Schreibrecht'));

		$response = $this->controller()->update(42, 7, 'Neuer Text');

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
	}

	/**
	 * @return array<string, array{string, array<int, mixed>}>
	 */
	public static function schreibendeEndpunkte(): array {
		return [
			'Anlegen' => ['create', [42, 1, 0.0, 'Notiz']],
			'Aendern' => ['update', [42, 7, 'Notiz']],
			'Loeschen' => ['destroy', [42, 7]],
		];
	}

	/**
	 * @param array<int, mixed> $argumente
	 */
	#[DataProvider('schreibendeEndpunkte')]
	public function testOhneZugriffAufDieDateiGehtNichts(string $methode, array $argumente): void {
		$this->fileResolver->method('resolveOwnNode')->willReturn(null);
		$this->fileResolver->method('currentUserId')->willReturn('andreas');

		$response = $this->controller()->$methode(...$argumente);

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}
}
