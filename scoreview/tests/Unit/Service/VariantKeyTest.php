<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\VariantKey;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The server's copy of the variant key grammar. The cases are those of
 * converter/lib/variantKey.test.mjs (VALID, INVALID) - keep both in step: a
 * key the viewer builds and the server refuses is a variant nobody can open,
 * and a key the server takes that the viewer never builds is a second
 * address for the same bytes.
 */
class VariantKeyTest extends TestCase {
	/** @return array<string, array{string}> */
	public static function valid(): array {
		$keys = [
			'full~phone~w~0', 'full~phonel~w~0', 'full~orig~c~0', 'full~orig~w~-12', 'full~orig~w~12',
			'ex0~orig~w~0', 'ex12~phone~c~3', 'part3~phone~w~-2', 'partAb_-9~orig~w~1',
		];
		return array_combine($keys, array_map(static fn (string $k) => [$k], $keys));
	}

	/** @return array<string, array{string}> */
	public static function invalid(): array {
		$keys = [
			VariantKey::BASE, '', 'full~orig~w', 'full~orig~w~0~x', 'full~orig~w~+2', 'full~orig~w~02',
			'full~orig~w~-0', 'full~orig~w~13', 'full~orig~x~0', 'full~A4~w~0', 'ex01~orig~w~0',
			'ex1000~orig~w~0', 'ex~orig~w~0', 'part~orig~w~0', 'part3.5~orig~w~0', 'part../x~orig~w~0',
			'whole~orig~w~0', 'FULL~orig~w~0',
		];
		return array_combine(array_map(static fn (string $k) => "'{$k}'", $keys), array_map(static fn (string $k) => [$k], $keys));
	}

	#[DataProvider('valid')]
	public function testReadsACanonicalKey(string $key): void {
		$this->assertNotNull(VariantKey::parse($key));
	}

	#[DataProvider('invalid')]
	public function testRefusesEverythingElse(string $key): void {
		$this->assertNull(VariantKey::parse($key));
	}

	public function testNamesTheParts(): void {
		$this->assertSame(
			['source' => 'part', 'excerpt' => null, 'partId' => '3', 'format' => 'phone', 'pitch' => 'w', 'transpose' => -2],
			VariantKey::parse('part3~phone~w~-2'),
		);
		$this->assertSame(2, VariantKey::parse('ex2~orig~c~0')['excerpt']);
		$this->assertSame('full', VariantKey::parse('full~phonel~w~5')['source']);
	}

	public function testALongPartIdStillFitsTheColumn(): void {
		$this->assertNotNull(VariantKey::parse('part' . str_repeat('a', 40) . '~phonel~w~-12'));
		$this->assertNull(VariantKey::parse('part' . str_repeat('a', 41) . '~orig~w~0'));
	}

	public function testTheSourceMustBeInTheScore(): void {
		$meta = ['excerpts' => [['id' => 0], ['id' => 1]], 'parts' => [['id' => '1'], ['id' => '3']]];
		$this->assertTrue(VariantKey::fitsScore(VariantKey::parse('ex1~orig~w~0'), $meta));
		$this->assertFalse(VariantKey::fitsScore(VariantKey::parse('ex2~orig~w~0'), $meta));
		$this->assertTrue(VariantKey::fitsScore(VariantKey::parse('part3~orig~w~1'), $meta));
		$this->assertFalse(VariantKey::fitsScore(VariantKey::parse('part2~orig~w~1'), $meta));
		$this->assertTrue(VariantKey::fitsScore(VariantKey::parse('full~phone~w~0'), []));
		// A base converted before "excerpts" existed has none to offer.
		$this->assertFalse(VariantKey::fitsScore(VariantKey::parse('ex0~orig~w~0'), ['parts' => []]));
	}
}
