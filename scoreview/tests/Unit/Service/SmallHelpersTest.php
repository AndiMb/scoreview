<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\FileNames;
use OCA\ScoreView\Service\TargetParts;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Three small helpers every write path goes through: names chosen in the
 * browser (FileNames), the parts a practice entry is for (TargetParts), and
 * the file lookup that is the access check (UserFileResolver).
 */
class SmallHelpersTest extends TestCase {
	// --- FileNames::clean -----------------------------------------------------

	/**
	 * @return array<string, array{string, ?string}>
	 */
	public static function names(): array {
		return [
			'plain' => ['Bass', 'Bass'],
			'suffix stripped, any case' => ['Bass.MP3', 'Bass'],
			'path separators become spaces' => ['a/b\\c', 'a b c'],
			'control characters' => ["a\x00b\nc", 'a b c'],
			// U+202E would show "Bass.mp3" as something else.
			'direction marks removed' => ["Bass\u{202E}3pm", 'Bass3pm'],
			'whitespace collapsed' => ["  Bass \t  Tenor ", 'Bass Tenor'],
			'only dots' => ['...', null],
			'empty after suffix' => ['.mp3', null],
		];
	}

	#[DataProvider('names')]
	public function testCleanMakesASafeName(string $raw, ?string $clean): void {
		$this->assertSame($clean, FileNames::clean($raw, ['.mp3']));
	}

	public function testCleanCutsByBytesWithoutBreakingACharacter(): void {
		$name = FileNames::clean(str_repeat('ü', 200), []);

		$this->assertNotNull($name);
		$this->assertLessThanOrEqual(FileNames::MAX_NAME_BYTES, strlen($name));
		$this->assertTrue(mb_check_encoding($name, 'UTF-8'));
	}

	public function testFirstFreeCountsFromTwo(): void {
		$taken = ['x (2).mp3', 'x (3).mp3'];
		$this->assertSame('x (4).mp3', FileNames::firstFree('x', '.mp3', fn (string $n) => in_array($n, $taken, true)));
	}

	// --- TargetParts ----------------------------------------------------------

	public function testNormalizeKeepsIdAndNameAndDropsDuplicates(): void {
		$json = TargetParts::normalize([['id' => 3, 'name' => 'Bass'], ['id' => '3', 'name' => 'again'], ['id' => 'p1']]);

		$this->assertSame([['id' => '3', 'name' => 'Bass'], ['id' => 'p1', 'name' => '']], TargetParts::decode($json));
	}

	/**
	 * @return array<string, array{mixed}>
	 */
	public static function invalidParts(): array {
		return [
			'not a list' => ['Bass'],
			'empty' => [[]],
			'too many' => [array_fill(0, TargetParts::MAX_PARTS + 1, ['id' => 'a'])],
			'entry not an object' => [['a']],
			'empty id' => [[['id' => '']]],
			'id too long' => [[['id' => str_repeat('a', TargetParts::MAX_ID_LENGTH + 1)]]],
			'name not a string' => [[['id' => 'a', 'name' => 5]]],
		];
	}

	#[DataProvider('invalidParts')]
	public function testNormalizeRefusesWhatIsNotAPartList(mixed $parts): void {
		$this->assertNull(TargetParts::normalize($parts));
	}

	public function testDecodeIsForgiving(): void {
		$this->assertSame([], TargetParts::decode(null));
		$this->assertSame([], TargetParts::decode(''));
		$this->assertSame([], TargetParts::decode('not json'));
	}

	// --- UserFileResolver -----------------------------------------------------

	private function resolver(?string $uid, ?Folder $folder = null, ?\Throwable $failure = null): UserFileResolver {
		$session = $this->createMock(IUserSession::class);
		$user = null;
		if ($uid !== null) {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($uid);
		}
		$session->method('getUser')->willReturn($user);
		$root = $this->createMock(IRootFolder::class);
		if ($failure !== null) {
			$root->method('getUserFolder')->willThrowException($failure);
		} else {
			$root->method('getUserFolder')->with($uid)->willReturn($folder ?? $this->createMock(Folder::class));
		}
		return new UserFileResolver($root, $session);
	}

	public function testResolvesThroughTheUsersOwnTree(): void {
		$node = $this->createMock(Node::class);
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->with(42)->willReturn([$node]);

		$this->assertSame($node, $this->resolver('anna', $folder)->resolveOwnNode(42));
	}

	public function testNoUserNoFile(): void {
		$this->assertNull($this->resolver(null)->resolveOwnNode(42));
		$this->assertNull($this->resolver(null)->currentUserId());
	}

	public function testAFileOutsideTheUsersTreeIsNull(): void {
		$folder = $this->createMock(Folder::class);
		$folder->method('getById')->willReturn([]);

		$this->assertNull($this->resolver('anna', $folder)->resolveOwnNode(42));
	}

	public function testAFailingLookupIsNullNotAnError(): void {
		$this->assertNull($this->resolver('anna', failure: new \RuntimeException('storage offline'))->resolveOwnNode(42));
	}
}
