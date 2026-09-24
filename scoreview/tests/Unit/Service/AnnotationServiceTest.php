<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Service\AnnotationService;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Die Rechte-Verzweigungen fuer Notizen (privat, geteilt) sind die
 * sicherheitsrelevanteste PHP-Logik der App. Vier Faelle je
 * Schreiboperation, und der Unterschied zwischen
 * "404, ohne Existenz zu bestaetigen" und "403" ist eine bewusste
 * Entscheidung (siehe AnnotationService), die ein Refactoring still
 * umdrehen koennte.
 */
class AnnotationServiceTest extends TestCase {
	private AnnotationMapper&MockObject $mapper;
	private IUserManager&MockObject $userManager;
	private AnnotationService $service;

	protected function setUp(): void {
		$this->mapper = $this->createMock(AnnotationMapper::class);
		$this->userManager = $this->createMock(IUserManager::class);
		$this->service = new AnnotationService($this->mapper, $this->userManager);
	}

	private function annotation(string $owner, string $visibility, int $measureNumber = 1): Annotation {
		$a = new Annotation();
		$a->setId(7);
		$a->setFileId(42);
		$a->setUserId($owner);
		$a->setVisibility($visibility);
		$a->setMeasureNumber($measureNumber);
		$a->setFraction(0.0);
		$a->setContent('alt');
		return $a;
	}

	// --- updateContent -------------------------------------------------------

	public function testUpdateEigenePrivateNotizGeht(): void {
		$annotation = $this->annotation('alice', Annotation::VISIBILITY_PRIVATE);
		$this->mapper->method('findByIdAndFileId')->willReturn($annotation);
		$this->mapper->expects($this->once())->method('update')->willReturnArgument(0);

		$result = $this->service->updateContent(7, 42, 'alice', false, 'neu');

		$this->assertNotNull($result);
		$this->assertSame('neu', $result->getContent());
	}

	public function testUpdateFremdePrivateNotizLiefertNullStattFehler(): void {
		// Bewusst null (Controller macht 404 daraus) statt einer Exception:
		// eine fremde private Notiz soll nicht einmal als existierend
		// bestaetigt werden.
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_PRIVATE));
		$this->mapper->expects($this->never())->method('update');

		$this->assertNull($this->service->updateContent(7, 42, 'alice', true, 'neu'));
	}

	public function testUpdateGeteilteNotizMitSchreibrechtGehtAuchFremd(): void {
		// Kernzusage: geteilt heisst "wer die Datei bearbeiten darf, darf
		// auch die Notiz bearbeiten" - unabhaengig von der Autorin.
		$annotation = $this->annotation('bob', Annotation::VISIBILITY_SHARED);
		$this->mapper->method('findByIdAndFileId')->willReturn($annotation);
		$this->mapper->expects($this->once())->method('update')->willReturnArgument(0);

		$result = $this->service->updateContent(7, 42, 'alice', true, 'neu');

		$this->assertNotNull($result);
		$this->assertSame('neu', $result->getContent());
	}

	public function testUpdateGeteilteNotizOhneSchreibrechtWirft(): void {
		// Hier bewusst eine Exception (Controller macht 403 daraus) statt
		// null: eine geteilte Notiz ist fuer jede Person mit Dateizugriff
		// ohnehin sichtbar, es gibt nichts zu verbergen.
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_SHARED));
		$this->mapper->expects($this->never())->method('update');

		$this->expectException(\RuntimeException::class);
		$this->service->updateContent(7, 42, 'alice', false, 'neu');
	}

	public function testUpdateEigeneGeteilteNotizOhneSchreibrechtWirftEbenfalls(): void {
		// Auch die eigene Notiz haengt an den DATEI-Rechten, sobald sie
		// geteilt ist - sonst koennte jemand ohne Schreibrecht die fuer alle
		// sichtbare Fassung aendern.
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('alice', Annotation::VISIBILITY_SHARED));

		$this->expectException(\RuntimeException::class);
		$this->service->updateContent(7, 42, 'alice', false, 'neu');
	}

	public function testUpdateUnbekannteIdLiefertNull(): void {
		$this->mapper->method('findByIdAndFileId')->willReturn(null);
		$this->assertNull($this->service->updateContent(7, 42, 'alice', true, 'neu'));
	}

	// --- delete --------------------------------------------------------------

	public function testDeleteEigenePrivateNotizGeht(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('alice', Annotation::VISIBILITY_PRIVATE));
		$this->mapper->expects($this->once())->method('delete');

		$this->assertTrue($this->service->delete(7, 42, 'alice', false));
	}

	public function testDeleteFremdePrivateNotizLiefertFalse(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_PRIVATE));
		$this->mapper->expects($this->never())->method('delete');

		$this->assertFalse($this->service->delete(7, 42, 'alice', true));
	}

	public function testDeleteGeteilteNotizOhneSchreibrechtWirft(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_SHARED));
		$this->mapper->expects($this->never())->method('delete');

		$this->expectException(\RuntimeException::class);
		$this->service->delete(7, 42, 'alice', false);
	}

	public function testDeleteGeteilteNotizMitSchreibrechtGeht(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_SHARED));
		$this->mapper->expects($this->once())->method('delete');

		$this->assertTrue($this->service->delete(7, 42, 'alice', true));
	}

	public function testDeleteUnbekannteIdLiefertFalse(): void {
		$this->mapper->method('findByIdAndFileId')->willReturn(null);
		$this->assertFalse($this->service->delete(7, 42, 'alice', true));
	}

	// --- serialize -----------------------------------------------------------

	public function testSerializeLiefertKeineRoheUserId(): void {
		// `mine` wird serverseitig entschieden; die userId geht absichtlich
		// gar nicht erst raus (siehe AnnotationService::serialize()).
		$data = $this->service->serialize($this->annotation('bob', Annotation::VISIBILITY_PRIVATE), 'alice');

		$this->assertArrayNotHasKey('userId', $data);
		$this->assertFalse($data['mine']);
	}

	public function testSerializeSetztMineFuerEigeneNotiz(): void {
		$data = $this->service->serialize($this->annotation('alice', Annotation::VISIBILITY_PRIVATE), 'alice');
		$this->assertTrue($data['mine']);
	}

	public function testSerializeLiefertAutornamenNurFuerGeteilteNotizen(): void {
		$user = $this->createMock(IUser::class);
		$user->method('getDisplayName')->willReturn('Bob Beispiel');
		$this->userManager->method('get')->with('bob')->willReturn($user);

		$geteilt = $this->service->serialize($this->annotation('bob', Annotation::VISIBILITY_SHARED), 'alice');
		$privat = $this->service->serialize($this->annotation('bob', Annotation::VISIBILITY_PRIVATE), 'alice');

		$this->assertSame('Bob Beispiel', $geteilt['authorName']);
		$this->assertNull($privat['authorName']);
	}

	public function testSerializeFaelltAufUserIdZurueckWennKontoGeloescht(): void {
		$this->userManager->method('get')->willReturn(null);

		$data = $this->service->serialize($this->annotation('bob', Annotation::VISIBILITY_SHARED), 'alice');

		$this->assertSame('bob', $data['authorName']);
	}

	public function testSerializeMarkiertVerwaisteNotiz(): void {
		// Takt 80 in einer Partitur, die nach einem Re-Upload nur noch 63
		// Takte hat.
		$data = $this->service->serialize($this->annotation('alice', Annotation::VISIBILITY_PRIVATE, 80), 'alice', 63);
		$this->assertTrue($data['orphaned']);
	}

	public function testSerializeMarkiertNichtVerwaistWennPartiturGewachsenIst(): void {
		// Ausdrueckliche Gegenprobe zum Kommentar in AnnotationService: eine
		// GROESSERE Taktzahl macht einen Anker nicht ungueltig - das ist der
		// Sinn eines musikalischen statt eines Pixel-Ankers.
		$data = $this->service->serialize($this->annotation('alice', Annotation::VISIBILITY_PRIVATE, 40), 'alice', 63);
		$this->assertFalse($data['orphaned']);
	}

	public function testSerializeLaesstOrphanedWegWennTaktzahlUnbekannt(): void {
		// Konvertierung noch nicht fertig - dann gibt es keine Aussage, und
		// es darf auch keine behauptet werden.
		$data = $this->service->serialize($this->annotation('alice', Annotation::VISIBILITY_PRIVATE, 80), 'alice', null);
		$this->assertArrayNotHasKey('orphaned', $data);
	}

	// --- Stimmnotizen und Stempel (B2, B3) -----------------------------------

	/**
	 * Die Leitungsrolle entscheidet bei Stimmnotizen - nicht die Autorschaft
	 * und nicht das Schreibrecht an der Datei. Eine Leitung ohne
	 * Schreibrecht darf, eine Sängerin mit Schreibrecht nicht.
	 */
	public function testStimmnotizAendertJedeLeitungAuchOhneSchreibrecht(): void {
		$annotation = $this->annotation('bob', Annotation::VISIBILITY_PARTS);
		$this->mapper->method('findByIdAndFileId')->willReturn($annotation);
		$this->mapper->expects($this->once())->method('update')->willReturnArgument(0);

		$result = $this->service->updateContent(7, 42, 'alice', false, 'Tenor: leiser', true);

		$this->assertSame('Tenor: leiser', $result?->getContent());
	}

	public function testStimmnotizOhneLeitungsrolleWirftAuchMitSchreibrecht(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('alice', Annotation::VISIBILITY_PARTS));
		$this->mapper->expects($this->never())->method('update');

		// 403 statt 404: Die Notiz ist fuer jede Person mit Dateizugriff
		// ohnehin sichtbar - auch fuer ihre abberufene Autorin.
		$this->expectException(\RuntimeException::class);
		$this->service->updateContent(7, 42, 'alice', true, 'neu', false);
	}

	public function testStimmnotizLoeschenNurDurchLeitung(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_PARTS));
		$this->mapper->expects($this->once())->method('delete');

		$this->assertTrue($this->service->delete(7, 42, 'alice', false, true));
	}

	public function testStimmnotizLoeschenOhneLeitungWirft(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_PARTS));
		$this->mapper->expects($this->never())->method('delete');

		$this->expectException(\RuntimeException::class);
		$this->service->delete(7, 42, 'alice', true, false);
	}

	/**
	 * Die Leitungsrolle oeffnet nichts an geteilten Notizen: Dort bleibt es
	 * beim Schreibrecht.
	 */
	public function testLeitungsrolleOeffnetKeineGeteilteNotiz(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_SHARED));

		$this->expectException(\RuntimeException::class);
		$this->service->updateContent(7, 42, 'alice', false, 'neu', true);
	}

	public function testLeitungsrolleOeffnetKeineFremdePrivateNotiz(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('bob', Annotation::VISIBILITY_PRIVATE));

		$this->assertNull($this->service->updateContent(7, 42, 'alice', true, 'neu', true));
		$this->assertFalse($this->service->delete(7, 42, 'alice', true, true));
	}

	public function testEineTextnotizDarfNichtLeerWerden(): void {
		$this->mapper->method('findByIdAndFileId')
			->willReturn($this->annotation('alice', Annotation::VISIBILITY_PRIVATE));
		$this->mapper->expects($this->never())->method('update');

		$this->expectException(\InvalidArgumentException::class);
		$this->service->updateContent(7, 42, 'alice', false, '   ');
	}

	public function testEinStempelDarfOhneTextSein(): void {
		$annotation = $this->annotation('alice', Annotation::VISIBILITY_PRIVATE);
		$annotation->setKind(Annotation::KIND_STAMP);
		$annotation->setStamp('breath');
		$this->mapper->method('findByIdAndFileId')->willReturn($annotation);
		$this->mapper->expects($this->once())->method('update')->willReturnArgument(0);

		$this->assertSame('', $this->service->updateContent(7, 42, 'alice', false, '')?->getContent());
	}

	public function testZielstimmenAendernWirktNurBeiStimmnotizen(): void {
		$stimmnotiz = $this->annotation('bob', Annotation::VISIBILITY_PARTS);
		$stimmnotiz->setTargetParts('[{"id":"3","name":"Tenor"}]');
		$privat = $this->annotation('alice', Annotation::VISIBILITY_PRIVATE);
		$this->mapper->method('findByIdAndFileId')->willReturnOnConsecutiveCalls($stimmnotiz, $privat);
		$this->mapper->method('update')->willReturnArgument(0);

		$neu = '[{"id":"2","name":"Alt"}]';
		$this->assertSame($neu, $this->service->updateContent(7, 42, 'alice', false, 'x', true, $neu)?->getTargetParts());
		$this->assertNull($this->service->updateContent(7, 42, 'alice', false, 'x', true, $neu)?->getTargetParts());
	}

	public function testCreateHaeltArtStempelZieleUndLeitungFest(): void {
		$this->mapper->expects($this->once())->method('insert')->willReturnArgument(0);

		$a = $this->service->create(42, 'alice', 12, 0.5, null, null, '', Annotation::VISIBILITY_PARTS,
			Annotation::KIND_STAMP, 'breath', '[{"id":"3","name":"Tenor"}]', true);

		$this->assertSame(Annotation::KIND_STAMP, $a->getKind());
		$this->assertSame('breath', $a->getStamp());
		$this->assertTrue($a->getByLeader());
		$data = $a->jsonSerialize();
		$this->assertSame([['id' => '3', 'name' => 'Tenor']], $data['targetParts']);
		$this->assertTrue($data['byLeader']);
	}

	/**
	 * Alte Notizen (vor der Migration angelegt) und eine kaputte Spalte
	 * serialisieren als Textnotiz ohne Ziel - die Notizliste der Partitur
	 * darf an einer einzelnen Zeile nicht scheitern.
	 */
	public function testSerializeVertraegtAlteUndKaputteZeilen(): void {
		$alt = $this->annotation('alice', Annotation::VISIBILITY_PRIVATE);
		$kaputt = $this->annotation('alice', Annotation::VISIBILITY_PARTS);
		$kaputt->setTargetParts('{kein json');

		$this->assertSame(['text', null, [], false], array_values(array_intersect_key(
			$this->service->serialize($alt, 'alice'), array_flip(['kind', 'stamp', 'targetParts', 'byLeader']))));
		$this->assertSame([], $this->service->serialize($kaputt, 'alice')['targetParts']);
	}

	public function testSerializeNenntDieLeitungEinerStimmnotiz(): void {
		$user = $this->createMock(IUser::class);
		$user->method('getDisplayName')->willReturn('Chorleitung');
		$this->userManager->method('get')->willReturn($user);

		$data = $this->service->serialize($this->annotation('bob', Annotation::VISIBILITY_PARTS), 'alice');

		$this->assertSame('Chorleitung', $data['authorName']);
	}
}
