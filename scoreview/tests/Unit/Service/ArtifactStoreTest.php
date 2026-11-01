<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\ArtifactStore;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The cache rules shared by base and variants: names from the URL are an
 * allowlist, and a run's pages replace an earlier run's completely.
 */
class ArtifactStoreTest extends TestCase {
	/**
	 * A folder that keeps its files in an array, so that what writePages()
	 * leaves behind can be read back.
	 *
	 * @param array<string, string> $files
	 */
	private function folder(array &$files): ISimpleFolder {
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('fileExists')->willReturnCallback(fn (string $n) => array_key_exists($n, $files));
		$folder->method('newFile')->willReturnCallback(function (string $n, $content) use (&$files) {
			$files[$n] = (string)$content;
			return $this->createMock(ISimpleFile::class);
		});
		$folder->method('getFile')->willReturnCallback(function (string $n) use (&$files) {
			if (!array_key_exists($n, $files)) {
				throw new NotFoundException($n);
			}
			$file = $this->createMock(ISimpleFile::class);
			$file->method('putContent')->willReturnCallback(function ($c) use (&$files, $n) {
				$files[$n] = (string)$c;
			});
			$file->method('delete')->willReturnCallback(function () use (&$files, $n) {
				unset($files[$n]);
			});
			return $file;
		});
		return $folder;
	}

	public function testFewerPagesThanTheRunBeforeLeaveNoneOfItsPagesBehind(): void {
		$files = ['page-1.svg' => 'old', 'page-2.svg' => 'old', 'page-3.svg' => 'old', 'meta.json' => '{}'];
		$store = new ArtifactStore($this->createMock(IAppData::class));

		$store->writePages($this->folder($files), ['<a/>', '<b/>']);

		$this->assertSame(['page-1.svg' => '<a/>', 'page-2.svg' => '<b/>', 'meta.json' => '{}'], $files);
	}

	public function testMorePagesThanBeforeAreAllWritten(): void {
		$files = ['page-1.svg' => 'old'];
		$store = new ArtifactStore($this->createMock(IAppData::class));

		$store->writePages($this->folder($files), ['<a/>', '<b/>', '<c/>']);

		$this->assertSame(['page-1.svg' => '<a/>', 'page-2.svg' => '<b/>', 'page-3.svg' => '<c/>'], $files);
	}

	/**
	 * @return array<string, array{string, ?int}>
	 */
	public static function pageNames(): array {
		return [
			'page' => ['page-7', 7],
			'leading zero' => ['page-01', null],
			'fraction' => ['page-1.5', null],
			'path' => ['page-../x', null],
			'sign' => ['page-+1', null],
			'zero' => ['page-0', null],
			'empty number' => ['page-', null],
			'other prefix' => ['pages-1', null],
		];
	}

	#[DataProvider('pageNames')]
	public function testPageNumberAcceptsOneSpellingOnly(string $name, ?int $number): void {
		$this->assertSame($number, ArtifactStore::pageNumber($name));
	}

	public function testAnUnknownNameNeverOpensTheFolder(): void {
		$store = new ArtifactStore($this->createMock(IAppData::class));
		$opened = false;

		try {
			$store->artifact('pdf', ['meta' => ['meta.json', 'application/json']], function () use (&$opened) {
				$opened = true;
				return $this->createMock(ISimpleFolder::class);
			});
			$this->fail('expected NotFoundException');
		} catch (NotFoundException) {
		}
		$this->assertFalse($opened);
	}

	public function testAMissingFolderIsNothingToDelete(): void {
		$appData = $this->createMock(IAppData::class);
		$appData->method('getFolder')->willThrowException(new NotFoundException('scoreview'));

		(new ArtifactStore($appData))->delete('42', 'e1');

		$this->addToAssertionCount(1);
	}
}
