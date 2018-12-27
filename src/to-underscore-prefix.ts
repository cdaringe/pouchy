/**
 * @module document-key-prefixer
 */

import { MaybeSavedPouchDoc } from '.' // eslint-disable-line

var KEYS = ['id', 'rev']

/* istanbul ignore next */
export function toUnderscorePrefix<Content = {}> (
  data: Content & MaybeSavedPouchDoc | (Content & MaybeSavedPouchDoc)[]
): Content & MaybeSavedPouchDoc | (Content & MaybeSavedPouchDoc)[] {
  if (!data) return data
  if (Array.isArray(data)) {
    return data.map(item => toUnderscorePrefix(item as any))
  }
  if ((<any>data).results) return toUnderscorePrefix((<any>data).results as any)
  if ((<any>data).docs) return toUnderscorePrefix((<any>data).docs as any)
  var key: string
  var value: any
  const contentData = data as { [key: string]: any }
  for (var i in KEYS) {
    key = KEYS[i]
    value = contentData[key]
    if (value) {
      if (!contentData['_' + key]) {
        contentData['_' + key] = value
        delete contentData[key]
      }
    }
  }
  return data
}
