'use strict'

var PouchDB = require('./bluebirdify-pouchdb')
var bluebird = require('bluebird')
var assign = require('lodash/assign')
var defaults = require('lodash/defaults')
var unique = require('lodash/uniq')
var toArray = require('lodash/toArray')
var get = require('lodash/get')
var url = require('url')
var path = require('path')
var designDocRegex = new RegExp('^_design/')
var couchUrlify = function (str) { return str.replace(/[^/a-z0-9_$()+-]/gi, '') }

/**
 * @constructor Pouchy
 * @param {object} opts
 * @param {string}  [opts.name] name of db. recommended for most dbs. calculated from derived url string if `conn` or `url` provided. otherwise, required
 * @param {object}  [opts.conn] creates `url` using the awesome and simple [url.format](https://www.npmjs.com/package/url#url-format-urlobj)
 * @param {boolean} [opts.couchdbSafe] [default: true] asserts that `name` provided or `url` provided will work with couchdb.  tests by asserting str conforms to [couch specs](https://wiki.apache.org/couchdb/HTTP_database_API#Naming_and_Addressing), minus the `/`.  This _may complain that some valid urls are invalid_.  Please be aware and disable if necessary.
 * @param {string}  [opts.url] url to remote CouchDB
 * @param {string}  [opts.path] path to store pouch on filesystem, if using on filesystem!  defaults to _PouchDB_ default of cwd
 * @param {object}  [opts.pouchConfig] PouchDB constructor [options](http://pouchdb.com/api.html#create_database)
 * @param {string}  [opts.replicate] [default: undefined] 'out/in/sync/both', where sync and both are ===
 * @param {boolean} [opts.replicateLive] [default: true] activates only if `replicate` is set
 * @param {boolean} [opts.verbose]
 */
function Pouchy (opts) {
  if (!opts) throw new ReferenceError('db options required')
  if (opts.verbose) this.verbose = true

  var couchdbSafe = opts.couchdbSafe === undefined ? true : opts.couchdbSafe
  var pathParts

  if (!opts.name && !opts.url && !opts.conn) {
    throw new ReferenceError('db name, url, or conn required to create or access pouchdb')
  }
  if (opts.url && opts.conn) {
    throw new ReferenceError('provide only a `url` or `conn` option')
  }

  /* istanbul ignore next */
  if (!this) { throw new ReferenceError('no `this` context.  did you forget `new`?') }

  if (opts.url) {
    this.url = opts.url
  } else if (opts.conn) {
    this.url = url.format(opts.conn)
  }

  // assert that url is safe for couchdb
  if (this.url) {
    pathParts = url.parse(this.url).pathname.split('/')
    // assert db name
    this.name = opts.name || pathParts[pathParts.length - 1]
    if (couchdbSafe && this.name !== couchUrlify(this.name.toLowerCase())) {
      throw new Error([
        (this.url ? '`url`' : '`conn`'),
        (this.url ? this.url : JSON.stringify(opts.conn)),
        'may not be couchdb safe. couchdb safe url:',
        couchUrlify(this.name.toLowerCase())
      ].join(' '))
    }
  } else {
    this.name = couchUrlify(opts.name).toLowerCase()
    if (couchdbSafe && this.name !== opts.name) {
      throw new Error([
        'provided name', '"' + opts.name + '"',
        'may not be couchdb safe. couchdb safe url:',
        this.name
      ].join(' '))
    }
  }

  this.path = path.resolve(opts.path || '', this.name)
  this.db = new PouchDB(
    opts.name ? this.path : this.url,
    opts.pouchConfig
  )

  if (opts.replicate) this._handleReplication(opts.replicate)
}

assign(Pouchy.prototype, {
  _handleReplication: function (opts) {
    let mode
    let replOpts
    /* istanbul ignore next */
    if (!this.url) throw new ReferenceError('url or conn object required to replicate')
    if (typeof opts === 'string') {
      mode = opts
      replOpts = { live: true, retry: true }
    } else {
      mode = Object.keys(opts)[0]
      replOpts = opts[mode]
    }
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

  _bindEarlyEventDetectors: function (emitter, replOpts) {
    /* istanbul ignore else */
    if (replOpts.live) this._handleSyncLikelyComplete(emitter, replOpts)
  },

  _handleSyncLikelyComplete: function (emitter) {
    if (this.verbose) console.log('trying to sync', this.name)
    let waitForSync
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
      emitter[action]('change', function (info) { resetSyncWaitTime('change', info) })
      emitter[action]('active', function (info) { resetSyncWaitTime('active', info) })
      emitter[action]('paused', function (info) { resetSyncWaitTime('paused', info) })
    }

    // set max wait time before moving on
    var MAX_SYNC_WAIT_TIMEOUT = 500
    var maxSyncWait = setTimeout(
      function () {
        /* istanbul ignore next */
        if (waitForSync) return
        resetSyncWaitTime('timeout', { timeout: MAX_SYNC_WAIT_TIMEOUT })
      },
      MAX_SYNC_WAIT_TIMEOUT
    )
    updateEmitters('addListener')
  },

  all: function (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = defaults(opts || {}, { include_docs: true })
    return this.db.allDocs(opts)
      .then(function getDocs (docs) {
        return docs.rows.reduce(function (r, v) {
          var doc = opts.include_docs ? v.doc : v
          // rework doc format to always have id ==> _id
          if (!opts.include_docs) {
            doc._id = doc.id
            delete doc.id
          }
          /* istanbul ignore next */
          if (!opts.includeDesignDocs) r.push(doc)
          else if (opts.includeDesignDocs && doc._id.match(designDocRegex)) r.push(doc)
          return r
        }, [])
      })
      .asCallback(cb)
  },

  add: function () {
    var cb
    var args = toArray(arguments)
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    return this.save.apply(this, args).asCallback(cb)
  },

  bulkGet: function (opts, cb) {
    /* istanbul ignore else */
    if (Array.isArray(opts)) opts = { docs: opts }
    opts.docs = opts.docs.map(function (doc) {
      // because PouchDB can't make up it's mind, we need
      // to map back to id and rev here
      let nDoc = assign({}, doc)
      /* istanbul ignore else */
      if (nDoc._id) nDoc.id = nDoc._id
      /* istanbul ignore else */
      if (nDoc._rev) nDoc.rev = nDoc._rev
      delete nDoc._rev
      delete nDoc._id
      return nDoc
    })
    return this.db.bulkGet(opts)
      .then(function (r) {
        return r.results.map(function (docGroup) {
          var doc = get(docGroup, 'docs[0].ok')
          if (!doc) {
            throw new ReferenceError('doc ' + docGroup.id + 'not found')
          }
          return doc
        })
      })
      .asCallback(cb)
  },

  createIndex: function () {
    /* istanbul ignore next */
    var cb
    /* istanbul ignore next */
    var args = toArray(arguments)
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    /* istanbul ignore next */
    return this.createIndicies.apply(this, args).asCallback(cb)
  },

  createIndicies: function (indicies, cb) {
    indicies = Array.isArray(indicies) ? indicies : [indicies]
    return bluebird.resolve()
      .then(function _createIndicies () {
        return this.db.createIndex({
          index: { fields: unique(indicies) }
        })
      }.bind(this))
      /* istanbul ignore next */
      .catch(function handleFailCreateIndicies (err) { if (err.status !== 409) throw err })
      .asCallback(cb)
  },

  clear: function () {
    var cb
    var args = toArray(arguments)
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    return this.deleteAll.apply(this, args).asCallback(cb)
  },

  delete: function (doc, opts, cb) {
    /* istanbul ignore next */
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    return this.db.remove(doc, opts).asCallback(cb)
  },

  deleteAll: function (cb) {
    return this.all()
      .then(function deleteEach (docs) {
        docs = docs.map(function (doc) { return this.delete(doc) }.bind(this))
        return Promise.all(docs)
      }.bind(this))
      .asCallback(cb)
  },

  deleteDB: function (cb) {
    /* istanbul ignore next */
    return this.db.destroy().asCallback(cb)
  },

  destroy: function () {
    var cb
    var args = toArray(arguments)
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    /* istanbul ignore else */
    if (this.syncEmitter) {
      this.syncEmitter.cancel()
    }
    return this.db.destroy.apply(this.db, args).asCallback(cb)
  },

  find: function (opts, cb) {
    return bluebird.resolve()
      .then(function _find () { return this.db.find(opts) }.bind(this))
      .then(function returnDocsArray (rslt) { return rslt.docs })
      .asCallback(cb)
  },

  update: function (doc, opts, cb) {
    /* istanbul ignore next */
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = opts || {}
    // http://pouchdb.com/api.html#create_document
    // db.put(doc, [docId], [docRev], [options], [callback])
    return this.db.put(doc, opts._id, opts._rev).then(function (meta) {
      doc._id = meta.id
      doc._rev = meta.rev
      return doc
    })
      .asCallback(cb)
  },

  save: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    // http://pouchdb.com/api.html#create_document
    // db.post(doc, [docId], [docRev], [options], [callback])
    var method = doc.hasOwnProperty('_id') && (doc._id || doc._id === 0) ? 'put' : 'post'
    return bluebird.resolve(this.db[method](doc))
      .then(function (meta) {
        delete meta.status
        doc._id = meta.id
        doc._rev = meta.rev
        return doc
      })
      .asCallback(cb)
  }

})

// proxy pouch methods, and pouch-find methods
var pouchMethods = [
  // proxy pouch instance methods
  'put',
  'post',
  'get',
  'remove',
  'bulkDocs',
  'allDocs',
  'changes',
  'replicate',
  'sync',
  'putAttachment',
  'getAttachment',
  'removeAttachment',
  'query',
  'viewCleanup',
  'info',
  'plugin',
  'compact',
  'revsDiff',
  'defaults',
  // proxy pouchdb-find methods
  // 'createIndex' => see methods above
  'getIndexes',
  'deleteIndex'
// 'find' => see methods above
]

pouchMethods.forEach(function (method) {
  /* istanbul ignore next */
  if (Pouchy.prototype[method]) { return }
  Pouchy.prototype[method] = function () {
    var cb
    var args = toArray(arguments)
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') cb = args.pop()
    var rtn = this.db[method].apply(this.db, args)
    if (rtn instanceof bluebird || rtn instanceof Promise) {
      return bluebird.resolve()
        .then(function proxyPouch () { return rtn })
        .asCallback(cb)
    }
    /* istanbul ignore next */
    return rtn
  }
})

Pouchy.PouchDB = PouchDB

module.exports = Pouchy
