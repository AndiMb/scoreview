// translate() for the whole frontend: @nextcloud/l10n with the cache from
// lib/translateCache.js in front. Components import it from here instead of
// from @nextcloud/l10n - see that file for why.
import { translate as nextcloudTranslate } from '@nextcloud/l10n'
import { createCachedTranslate } from './lib/translateCache.js'

export const translate = createCachedTranslate(nextcloudTranslate)
