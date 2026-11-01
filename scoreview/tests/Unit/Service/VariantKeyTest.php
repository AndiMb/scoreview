<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\VariantKey;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The server's copy of the variant key grammar, tested against the same
 * cases as converter/lib/variantKey.test.mjs - both read
 * tests/fixtures/variant-keys.json. A key the viewer builds and the server
 * refuses is a variant nobody can open, and a key the server takes that the
 * viewer never builds is a second address for the same bytes.
 */
class VariantKeyTest extends TestCase {
	/** @return array{valid: list<string>, invalid: list<string>} */
	private static function cases(): array {
		return json_decode((string)file_get_contents(__DIR__ . '/../../fixtures/variant-keys.json'), true, 512, JSON_THROW_ON_ERROR);
	}

	/** @return array<string, array{string}> */
	public static function valid(): array {
		$keys = self::cases()['valid'];
		return array_combine($keys, array_map(static fn (string $k) => [$k], $keys));
	}

	/** @return array<string, array{string}> */
	public static function invalid(): array {
		$keys = self::cases()['invalid'];
		return array_combine(array_map(static fn (string $k) => "'{$k}'", $keys), array_map(static fn (string $k) => [$k], $keys));
	}

	public function testTheFixtureRefusesTheBaseKey(): void {
		$this->assertContains(VariantKey::BASE, self::cases()['invalid']);
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
