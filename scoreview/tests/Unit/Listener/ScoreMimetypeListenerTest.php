<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\BackgroundJob\RegisterMimetypeJob;
use OCA\ScoreView\Listener\ScoreMimetypeListener;
use OCP\BackgroundJob\IJobList;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use PHPUnit\Framework\TestCase;

/**
 * Der Listener haelt neu hochgeladene Partituren auf dem richtigen Mimetype.
 *
 * Zwei Eigenschaften sind hier der Testgegenstand, beide leicht wieder
 * kaputtzumachen:
 *
 * 1. Erkannt wird an der **Endung**. Ein Vergleich am Mimetype liefe ins
 *    Leere - der ist ja gerade der falsche.
 * 2. Steht der Mimetype schon richtig (Instanz mit Registrierung in
 *    `config/`), wird **kein** Job eingereiht. Sonst liefe nach jedem Upload
 *    ein Durchlauf ueber die ganze Filecache-Tabelle, ohne je etwas zu
 *    aendern.
 */
class ScoreMimetypeListenerTest extends TestCase {
	private function knoten(string $name, string $mimetype = 'application/octet-stream'): Node {
		$node = $this->createMock(Node::class);
		$node->method('getName')->willReturn($name);
		$node->method('getMimetype')->willReturn($mimetype);
		return $node;
	}

	public function testReihtDenJobEinWennDerMimetypeFalschIst(): void {
		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->once())->method('add')->with(RegisterMimetypeJob::class);

		(new ScoreMimetypeListener($jobList))->handle(new NodeCreatedEvent($this->knoten('satz.mscz')));
	}

	public function testErkenntDieEndungUnabhaengigVonGrossschreibung(): void {
		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->once())->method('add');

		(new ScoreMimetypeListener($jobList))->handle(new NodeWrittenEvent($this->knoten('SATZ.MSCZ')));
	}

	public function testRuehrtSichNichtBeiRichtigemMimetype(): void {
		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->never())->method('add');

		(new ScoreMimetypeListener($jobList))
			->handle(new NodeCreatedEvent($this->knoten('satz.mscz', 'application/x-musescore')));
	}

	public function testIgnoriertAndereDateien(): void {
		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->never())->method('add');

		(new ScoreMimetypeListener($jobList))->handle(new NodeCreatedEvent($this->knoten('urlaub.jpg')));
	}

	/**
	 * Ein Knoten, der seinen eigenen Mimetype nicht nennen kann, ist kein
	 * Grund, den Upload scheitern zu lassen - und im Zweifel wird der Job
	 * eingereiht, er ist wiederholbar.
	 */
	public function testReihtEinWennDerKnotenNichtsSagenKann(): void {
		$node = $this->createMock(Node::class);
		$node->method('getName')->willReturn('satz.mscz');
		$node->method('getMimetype')->willThrowException(new NotFoundException());

		$jobList = $this->createMock(IJobList::class);
		$jobList->expects($this->once())->method('add')->with(RegisterMimetypeJob::class);

		(new ScoreMimetypeListener($jobList))->handle(new NodeCreatedEvent($node));
	}
}
