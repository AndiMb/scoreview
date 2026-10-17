<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\SiblingFileException;
use OCA\ScoreView\Service\SiblingFileService;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotPermittedException;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The shared way of saving a file next to the score (practice track, PDF).
 */
class SiblingFileServiceTest extends TestCase {
	private int $free = -3;
	private IRootFolder&MockObject $root;
	private Folder&MockObject $folder;

	protected function setUp(): void {
		$this->root = $this->createMock(IRootFolder::class);
		$userFolder = $this->createMock(Folder::class);
		$this->root->method('getUserFolder')->willReturn($userFolder);
		$userFolder->method('getRelativePath')->willReturnCallback(fn (string $p) => substr($p, strlen('/anna/files')));
		$this->folder = $this->createMock(Folder::class);
		$this->folder->method('getFreeSpace')->willReturnCallback(fn () => $this->free);
	}

	private function file(string $name): File&MockObject {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn(9);
		$file->method('getName')->willReturn($name);
		$file->method('getPath')->willReturn('/anna/files/Chor/' . $name);
		return $file;
	}

	/** @return resource */
	private function pdf() {
		$s = fopen('php://temp', 'r+');
		fwrite($s, '%PDF-1.4');
		rewind($s);
		return $s;
	}

	private function reason(callable $call): string {
		try {
			$call();
		} catch (SiblingFileException $e) {
			return $e->getReason();
		}
		$this->fail('no exception');
	}

	public function testWritesWithTheGivenExtension(): void {
		$this->folder->method('nodeExists')->willReturn(false);
		$this->folder->method('isCreatable')->willReturn(true);
		$this->folder->expects($this->once())->method('newFile')->with('Aequale No. 1.pdf')->willReturn($this->file('Aequale No. 1.pdf'));

		$saved = (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Aequale No. 1', '.pdf', false);

		$this->assertSame(['fileId' => 9, 'name' => 'Aequale No. 1.pdf', 'path' => '/Chor/Aequale No. 1.pdf'], $saved);
	}

	public function testDoesNotDoubleAnExtensionTheNameAlreadyHas(): void {
		$this->folder->method('nodeExists')->willReturn(false);
		$this->folder->method('isCreatable')->willReturn(true);
		$this->folder->expects($this->once())->method('newFile')->with('Ave.pdf')->willReturn($this->file('Ave.pdf'));

		(new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave.pdf', '.pdf', false);
	}

	public function testExistingFileWithoutReplaceOffersAFreeName(): void {
		$this->folder->method('nodeExists')->willReturnCallback(fn (string $n) => $n === 'Ave.pdf');
		$this->folder->method('get')->willReturn($this->file('Ave.pdf'));
		$this->folder->expects($this->never())->method('newFile');
		try {
			(new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave', '.pdf', false);
			$this->fail('no exception');
		} catch (SiblingFileException $e) {
			$this->assertSame(SiblingFileException::EXISTS, $e->getReason());
			$this->assertSame('Ave (2).pdf', $e->getSuggested());
		}
	}

	public function testReplaceWritesIntoTheExistingFile(): void {
		$existing = $this->file('Ave.pdf');
		$existing->method('isUpdateable')->willReturn(true);
		$existing->expects($this->once())->method('putContent');
		$this->folder->method('nodeExists')->willReturn(true);
		$this->folder->method('get')->willReturn($existing);
		$this->folder->expects($this->never())->method('newFile');

		$saved = (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave', '.pdf', true);

		$this->assertSame('Ave.pdf', $saved['name']);
	}

	public function testNoWritePermission(): void {
		$this->folder->method('nodeExists')->willReturn(false);
		$this->folder->method('isCreatable')->willReturn(false);
		$this->assertSame(SiblingFileException::FORBIDDEN, $this->reason(
			fn () => (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave', '.pdf', false),
		));
	}

	public function testTooLittleSpaceIsCheckedBeforeWriting(): void {
		$this->free = 1;
		$this->folder->method('nodeExists')->willReturn(false);
		$this->folder->method('isCreatable')->willReturn(true);
		$this->folder->expects($this->never())->method('newFile');
		$this->assertSame(SiblingFileException::STORAGE_FULL, $this->reason(
			fn () => (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave', '.pdf', false),
		));
	}

	public function testAFailedCreationLeavesNoHalfFile(): void {
		$half = $this->createMock(File::class);
		$half->expects($this->once())->method('delete');
		$this->folder->method('nodeExists')->willReturnOnConsecutiveCalls(false, true);
		$this->folder->method('isCreatable')->willReturn(true);
		$this->folder->method('get')->willReturn($half);
		$this->folder->method('newFile')->willThrowException(new NotPermittedException('quota'));
		$this->assertSame(SiblingFileException::FORBIDDEN, $this->reason(
			fn () => (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), 'Ave', '.pdf', false),
		));
	}

	public function testUnusableName(): void {
		$this->assertSame(SiblingFileException::INVALID, $this->reason(
			fn () => (new SiblingFileService($this->root))->save($this->folder, 'anna', $this->pdf(), '   ', '.pdf', false),
		));
	}
}
