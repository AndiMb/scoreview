<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

/**
 * Another request is fetching the SoundFont right now
 * (SoundFontService::fetchIntoCache()). Not a failure of the source: the
 * caller answers with the cached copy, or the browser asks again shortly.
 */
class SoundFontBusyException extends ConverterException {
}
