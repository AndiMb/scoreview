<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\Listener\NodeDeletedListener;
use OCA\ScoreView\Service\ConversionService;
use OCP\EventDispatcher\Event;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\FileInfo;
use OCP\Files\Folder;
use OCP\Files\Node;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Der Listener raeumt beim Loeschen einer Partitur den Cache weg - und
 * ruehrt die Notizen ausdruecklich NICHT an.
 *
 * Letzteres ist der eigentliche Testgegenstand: `NodeDeletedEvent` feuert
 * schon beim Verschieben in den Papierkorb (an der Testinstanz nachgemessen,
 * die Datei behaelt dort ihre fileId). Wuerde hier jemand spaeter
 * "der Vollstaendigkeit halber" das Loeschen der Notizen ergaenzen, waere
 * das ein unumkehrbarer Verlust fuer eine umkehrbare Handlung - und diese
 * Tests schlagen dann an, weil der Listener seinen Mapper gar nicht bekommt.
 */
class NodeDeletedListenerTest extends TestCase {
	private function fileNode(string $name, int $id, string $type = FileInfo::TYPE_FILE): Node {
		$node = $this->createMock(Node::class);
		$node->method('getName')->willReturn($name);
		$node->method('getId')->willReturn($id);
		$node->method('getType')->willReturn($type);
		return $node;
	}

	private function listener(ConversionService $service): NodeDeletedListener {
		return new NodeDeletedListener($service, $this->createMock(LoggerInterface::class));
	}

	public function testRaeumtDenCacheEinerGeloeschtenPartiturWeg(): void {
		$service = $this->createMock(ConversionService::class);
		$service->expects($this->once())->method('deleteAllForFile')->with(42);

		$this->listener($service)->handle(new NodeDeletedEvent($this->fileNode('satz.mscz', 42)));
	}

	public function testErkenntDieEndungUnabhaengigVonGrossschreibung(): void {
		$service = $this->createMock(ConversionService::class);
		$service->expects($this->once())->method('deleteAllForFile')->with(7);

		$this->listener($service)->handle(new NodeDeletedEvent($this->fileNode('SATZ.MSCZ', 7)));
	}

	public function testIgnoriertAndereDateien(): void {
		$service = $this->createMock(ConversionService::class);
		$service->expects($this->never())->method('deleteAllForFile');

		$this->listener($service)->handle(new NodeDeletedEvent($this->fileNode('urlaub.jpg', 1)));
	}

	public function testIgnoriertOrdner(): void {
		// Ein Ordner traegt keine Konvertierung; seine Kinder feuern eigene
		// Ereignisse bzw. werden vom Aufraeum-Job erwischt.
		$service = $this->createMock(ConversionService::class);
		$service->expects($this->never())->method('deleteAllForFile');

		$ordner = $this->createMock(Folder::class);
		$ordner->method('getName')->willReturn('Noten.mscz');
		$ordner->method('getType')->willReturn(FileInfo::TYPE_FOLDER);

		$this->listener($service)->handle(new NodeDeletedEvent($ordner));
	}

	public function testIgnoriertAndereEreignisse(): void {
		$service = $this->createMock(ConversionService::class);
		$service->expects($this->never())->method('deleteAllForFile');

		$this->listener($service)->handle(new Event());
	}

	public function testLaesstDasLoeschenNichtAnEinemAufraeumfehlerScheitern(): void {
		// Wenn IAppData zickt, darf das nicht die Loeschoperation der Nutzerin
		// mit in den Abgrund reissen - der Job holt es ohnehin nach.
		$service = $this->createMock(ConversionService::class);
		$service->method('deleteAllForFile')->willThrowException(new \RuntimeException('Speicher weg'));

		$this->listener($service)->handle(new NodeDeletedEvent($this->fileNode('satz.mscz', 42)));

		$this->addToAssertionCount(1);
	}
}
