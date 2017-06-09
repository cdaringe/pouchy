'use strict'

var KEYS = ['id', 'rev']

/* istanbul ignore next */
module.exports = function toUnderscorePrefix (data) {
  if (!data) return data
  if (Array.isArray(data)) return data.map(toUnderscorePrefix)
  if (data.results) return toUnderscorePrefix(data.results)
  if (data.docs) return toUnderscorePrefix(data.docs)
  var key
  var value
  for (var i in KEYS) {
    key = KEYS[i]
    value = data[key]
    if (value) {
      if (!data['_' + key]) {
        data['_' + key] = value
        delete data[key]
      }
    }
  }
  return data
}
