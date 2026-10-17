<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Search;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Search\ScoreSearchProvider;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IMimeTypeDetector;
use OCP\Files\IRootFolder;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\Search\ISearchQuery;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The search over title and composer (E17). What matters most is what it
 * does NOT show: a score outside the searcher's own file tree.
 */
class ScoreSearchProviderTest extends TestCase {
	private ScoreConversionMapper&MockObject $mapper;
	private Folder&MockObject $userFolder;
	/** @var array<int, File> file id => file in the searcher's tree */
	private array $files = [];
	/** @var list<array{int, int}> limit, offset of every query */
	private array $queries = [];

	protected function setUp(): void {
		$this->mapper = $this->createMock(ScoreConversionMapper::class);
		$this->userFolder = $this->createMock(Folder::class);
		$this->userFolder->method('getById')->willReturnCallback(fn (int $id) => isset($this->files[$id]) ? [$this->files[$id]] : []);
		$this->userFolder->method('getRelativePath')->willReturnCallback(fn (string $p) => substr($p, strlen('/anna/files')));
	}

	private function provider(): ScoreSearchProvider {
		$root = $this->createMock(IRootFolder::class);
		$root->method('getUserFolder')->with('anna')->willReturn($this->userFolder);
		$url = $this->createMock(IURLGenerator::class);
		$url->method('linkToRouteAbsolute')->willReturnCallback(fn (string $route, array $p) => $route . '?' . http_build_query($p));
		$mime = $this->createMock(IMimeTypeDetector::class);
		$mime->method('mimeTypeIcon')->willReturn('/icon.svg');
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new ScoreSearchProvider($this->mapper, $root, $url, $mime, $l);
	}

	/** The table: rows in order; the mapper pages through them. */
	private function table(array $rows): void {
		$this->mapper->method('search')->willReturnCallback(function (string $term, int $limit, int $offset) use ($rows) {
			$this->queries[] = [$limit, $offset];
			return array_slice($rows, $offset, $limit);
		});
	}

	private function row(int $fileId, ?string $title = null, ?string $composer = null): ScoreConversion {
		$row = new ScoreConversion();
		$row->setFileId($fileId);
		$row->setTitle($title);
		$row->setComposer($composer);
		return $row;
	}

	private function own(int $id, string $name, string $folder = '/anna/files/Chor'): void {
		$parent = $this->createMock(Folder::class);
		$parent->method('getPath')->willReturn($folder);
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($id);
		$file->method('getName')->willReturn($name);
		$file->method('getMimetype')->willReturn('application/x-musescore');
		$file->method('getParent')->willReturn($parent);
		$file->method('getPath')->willReturn($folder . '/' . $name);
		$this->files[$id] = $file;
	}

	private function search(string $term, int $limit = 5, $cursor = null): array {
		$user = $this->createMock(IUser::class);
		$user->method('getUID')->willReturn('anna');
		$query = $this->createMock(ISearchQuery::class);
		$query->method('getTerm')->willReturn($term);
		$query->method('getLimit')->willReturn($limit);
		$query->method('getCursor')->willReturn($cursor);
		return json_decode(json_encode($this->provider()->search($user, $query)), true);
	}

	public function testShowsTitleComposerAndFolderAndLinksToFiles(): void {
		$this->own(3569, 'Aequale_No_1.mscz');
		$this->table([$this->row(3569, 'Aequale No. 1', 'Anton Bruckner')]);

		$result = $this->search('Bruckner');

		$this->assertFalse($result['isPaginated']);
		$this->assertCount(1, $result['entries']);
		$entry = $result['entries'][0];
		$this->assertSame('Aequale No. 1', $entry['title']);
		$this->assertSame('Anton Bruckner · /Chor/Aequale_No_1.mscz', $entry['subline']);
		$this->assertSame('files.View.showFile?fileid=3569', $entry['resourceUrl']);
		$this->assertStringContainsString('fileId=3569', $entry['thumbnailUrl']);
		$this->assertSame('/icon.svg', $entry['icon']);
	}

	public function testWithoutTitleTheFileNameIsShown(): void {
		$this->own(7, 'Ave_verum.mscz', '/anna/files');
		$this->table([$this->row(7, null, null)]);

		$entry = $this->search('ave')['entries'][0];

		$this->assertSame('Ave_verum', $entry['title']);
		$this->assertSame('/Ave_verum.mscz', $entry['subline']);
	}

	public function testAScoreOutsideTheOwnTreeLeavesNoTrace(): void {
		$this->own(2, 'mine.mscz');
		$this->table([$this->row(1, 'Secret Mass', 'Someone'), $this->row(2, 'Mine')]);

		$result = $this->search('mass');

		$this->assertSame(['Mine'], array_column($result['entries'], 'title'));
		$this->assertStringNotContainsString('Secret', json_encode($result));
	}

	public function testReadsOnWhenHitsWereDroppedAndTheCursorCountsRowsRead(): void {
		// Rows 1-3 belong to somebody else; 4 and 5 are mine.
		$this->own(4, 'a.mscz');
		$this->own(5, 'b.mscz');
		$this->own(6, 'c.mscz');
		$this->table(array_map(fn (int $id) => $this->row($id, "T$id"), [1, 2, 3, 4, 5, 6, 7]));

		$result = $this->search('title', 2);

		$this->assertSame(['T4', 'T5'], array_column($result['entries'], 'title'));
		$this->assertTrue($result['isPaginated']);
		$this->assertSame(5, $result['cursor'], 'behind row 5, the last one used');
		$this->assertSame([[2, 0], [2, 2], [2, 4]], $this->queries);

		$next = $this->search('title', 2, $result['cursor']);
		$this->assertSame(['T6'], array_column($next['entries'], 'title'));
		$this->assertFalse($next['isPaginated'], 'the table ended');
	}

	public function testGivesUpAfterThreeRounds(): void {
		$this->table(array_map(fn (int $id) => $this->row($id, "T$id"), range(1, 20)));

		$result = $this->search('title', 2);

		$this->assertSame([], $result['entries']);
		$this->assertCount(3, $this->queries);
		$this->assertTrue($result['isPaginated']);
		$this->assertSame(6, $result['cursor']);
	}

	public function testAShortTermFindsNothingWithoutAQuery(): void {
		$this->mapper->expects($this->never())->method('search');
		$this->assertSame([], $this->search(' a ')['entries']);
	}

	public function testOrderNearFilesOnFilesRoutesAndLaterElsewhere(): void {
		$this->assertSame(25, $this->provider()->getOrder('files.View.index', []));
		$this->assertSame(60, $this->provider()->getOrder('dashboard.dashboard.index', []));
		$this->assertSame('scoreview', $this->provider()->getId());
	}
}
