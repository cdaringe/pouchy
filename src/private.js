'use strict'

var isNil = require('lodash/isNil')
var url = require('url')
function couchUrlify (str) { return str.replace(/[^/a-z0-9_$()+-]/gi, '') }

var POUCHY_API_DOCS_URI = 'https://cdaringe.github.io/pouchy'
var MAX_SYNC_WAIT_TIMEOUT = 500

/** @lends Pouchy.prototype */
module.exports = {
  _validatePouchyOpts: function _validatePouchyOpts (opts) {
    if (!opts || !opts.name && !opts.url && !opts.conn) {
      throw new ReferenceError([
        'missing pouchy database paramters.  please see: ' + POUCHY_API_DOCS_URI + '\n',
        '\tif you are creating a local database (browser or node), provide a `name` key.\n',
        '\tif you are just using pouchy to access a remote database, provide a `url` or `conn` key\n',
        '\tif you are creating a database to replicate with a remote database, provide a',
        '`url` or `conn` key, plus a replicate key.\n'
      ].join(''))
    }
    /* istanbul ignore next */
    if (opts.url && opts.conn) throw new ReferenceError('provide only a `url` or `conn` option')
    /* istanbul ignore next */
    if (!this) throw new ReferenceError('no `this` context.  did you forget `new`?')
  },
  /**
   * @private
   */
  _handleReplication: function _handleReplication (opts) {
    var mode
    var replOpts
    /* istanbul ignore next */
    if (!this.url) throw new ReferenceError('url or conn object required to replicate')
    if (typeof opts === 'string') {
      mode = opts
      replOpts = { live: true, retry: true }
    } else {
      mode = Object.keys(opts)[0]
      replOpts = opts[mode]
    }
    this._replicationOpts = replOpts
    switch (mode) {
      /* istanbul ignore next */
      case 'out':
        this.syncEmitter = this.db.replicate.to(this.url, replOpts)
        break
      /* istanbul ignore next */
      case 'in':
        this.syncEmitter = this.db.replicate.from(this.url, replOpts)
        break
      case 'sync':
        this.syncEmitter = this.db.sync(this.url, replOpts)
        break
      default:
        /* istanbul ignore next */
        throw new Error([
          "in/out replication direction must be specified, got '",
          mode + "'"
        ].join(' '))
    }
    this._bindEarlyEventDetectors(this.syncEmitter, replOpts)
  },

  _getUrlFromOpts (opts) {
    if (!isNil(opts.url)) return opts.url
    if (!isNil(opts.conn)) return url.format(opts.conn)
    return null
  },

  _setDbNameFromUri: function _setDbNameFromUri (uri) {
    var pathParts = url.parse(uri).pathname.split('/')
    this.name = this.name || pathParts[pathParts.length - 1]
    return this.name
  },

  _setDbNameFromOpts: function _setDbNameFromOpts (opts) {
    /* istanbul ignore next */
    if (!opts.name) throw new Error('local pouchy database requires a `name` field')
    return opts.name
  },

  _validateDbName: function _validateDbName () {
    var couchDbSafeName = couchUrlify(this.name.toLowerCase())
    if (this.name === couchDbSafeName) return
    throw new Error([
      'database name may not be couchdb safe.',
      '\tunsafe name: ' + this.name,
      '\tsafe name: ' + couchDbSafeName
    ].join('\n'))
  },

  /**
   * expose replication options used on db sync!
   * @returns {object} replication options used (if any) fed into pouchdb `.replicate(...)`
   */
  getReplicationOptions: function getReplicationOptions () {
    /* istanbul ignore next */
    return this._replicationOpts
  },

  /**
   * @private
   */
  _bindEarlyEventDetectors: function _bindEarlyEventDetectors (emitter, replOpts) {
    /* istanbul ignore else */
    if (replOpts.live) this._handleSyncLikelyComplete(emitter, replOpts)
  },

  /**
   * @private
   */
  _handleSyncLikelyComplete: function _handleSyncLikelyComplete (emitter) {
    /* istanbul ignore next */
    if (this.verbose) console.log('trying to sync', this.name)
    var waitForSync
    /* istanbul ignore next */
    var resetSyncWaitTime = function (evt, info) {
      if (this.verbose) console.log(this.name, evt, info)
      clearTimeout(maxSyncWait)
      clearTimeout(waitForSync)
      waitForSync = setTimeout(function () {
        if (this.verbose) console.log(this.name, 'hasLikelySynced')
        this._hasLikelySynced = true
        emitter.emit('hasLikelySynced')
        updateEmitters('removeListener')
      }.bind(this), 150)
    }.bind(this)
    /* istanbul ignore next */
    var updateEmitters = function (action) {
      emitter[action]('complete', function (info) { resetSyncWaitTime('complete', info) })
      emitter[action]('change', function (info) { resetSyncWaitTime('change', info) })
      emitter[action]('active', function (info) { resetSyncWaitTime('active', info) })
      emitter[action]('paused', function (info) { resetSyncWaitTime('paused', info) })
    }

    // set max wait time before moving on
    var maxSyncWait = setTimeout(
      function () {
        /* istanbul ignore next */
        if (waitForSync) return
        resetSyncWaitTime('timeout', { timeout: MAX_SYNC_WAIT_TIMEOUT })
      },
      MAX_SYNC_WAIT_TIMEOUT
    )
    updateEmitters('addListener')
  }
}
