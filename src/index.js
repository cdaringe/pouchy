'use strict'

var PouchDB = require('pouchdb')
PouchDB.plugin(require('pouchdb-find'))
var assign = require('lodash/assign')
var defaults = require('lodash/defaults')
var unique = require('lodash/uniq')
var toArray = require('lodash/toArray')
var get = require('lodash/get')
var url = require('url')
var path = require('path')
var designDocRegex = new RegExp('^_design/')
var couchUrlify = function (str) { return str.replace(/[^/a-z0-9_$()+-]/gi, '') }
var bb = require('bluebird')

/**
 * @constructor Pouchy
 * @param {object} opts {
 *     name: {string} kname of db. calculated from derived url string if `conn` or `url` provided. otherwise, required
 *     conn: {object=} creates `url` using the awesome and simple [url.format](https://www.npmjs.com/package/url#url-format-urlobj)
 *     couchdbSafe {boolean=} [default: true] asserts that `name` provided or `url` provided will work with couchdb.  tests by asserting str conforms to [couch specs](https://wiki.apache.org/couchdb/HTTP_database_API#Naming_and_Addressing), minus the `/`.  This _may complain that some valid urls are invalid_.  Please be aware and disable if necessary.
 *     url: {string=} url to remote CouchDB
 *     path: {string=} path to store pouch on filesystem, if using on filesystem!  defaults to _PouchDB_ default of cwd
 *     pouchConfig: {object=} PouchDB constructor [options](http://pouchdb.com/api.html#create_database)
 *     replicate: {string=} [default: undefined] 'out/in/sync/both', where sync and both are ===
 *     replicateLive: {boolean=} [default: true] activates only if `replicate` is set
 * }
 */
function Pouchy (opts) {
  var couchdbSafe = opts.couchdbSafe === undefined ? true : opts.couchdbSafe
  var pathParts

  if (!opts) {
    throw new ReferenceError('db options required')
  }
  if (!opts.name && !opts.url && !opts.conn) {
    throw new ReferenceError('db name, url, or conn required to create or access pouchdb')
  }
  if (!this) { throw new ReferenceError('no `this` context.  did you forget `new`?') }

  if (opts.url) {
    this.url = opts.url
  } else if (opts.conn) {
    this.url = url.format(opts.conn)
  }

  // assert that url is safe looking
  if (this.url) {
    pathParts = url.parse(this.url).pathname.split('/')
    // check opts.name, as name may have / in it
    this.name = opts.name || pathParts[pathParts.length - 1]
    if (couchdbSafe && this.name !== couchUrlify(this.name.toLowerCase())) {
      throw new Error([
        'provided `url` or `conn` "',
        ((opts.conn && JSON.stringify(opts.conn)) || this.url),
        '" may not be couchdb safe'
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
    if (!this.url) throw new ReferenceError('url or conn object required to replicate')
    if (typeof opts === 'string') {
      mode = opts
      replOpts = { live: true, retry: true }
    } else {
      mode = Object.keys(opts)[0]
      replOpts = opts[mode]
    }
    switch (mode) {
      case 'out':
        this.syncEmitter = this.db.replicate.to(this.url, replOpts)
        break
      case 'in':
        this.syncEmitter = this.db.replicate.from(this.url, replOpts)
        break
      case 'sync':
        this.syncEmitter = this.db.sync(this.url, replOpts)
        break
      default:
        throw new Error([
          "in/out replication direction must be specified, got '",
          mode + "'"
        ].join(' '))
    }
    this._bindEarlyEventDetectors(this.syncEmitter, replOpts)
  },

  _bindEarlyEventDetectors: function (emitter, replOpts) {
    if (replOpts.live) this._handleSyncLikelyComplete(emitter, replOpts)
  },

  _handleSyncLikelyComplete: function (emitter) {
    let waitForSync
    var resetSyncWaitTime = function (info) {
      clearTimeout(maxSyncWait)
      clearTimeout(waitForSync)
      waitForSync = setTimeout(() => {
        emitter.emit('hasLikelySynced')
        updateEmitters('removeListener')
      }, 150)
    }
    var updateEmitters = function (action) {
      emitter[action]('change', resetSyncWaitTime)
      emitter[action]('active', resetSyncWaitTime)
      emitter[action]('paused', resetSyncWaitTime)
    }

    // set max wait time before moving on
    var maxSyncWait = setTimeout(
      function () {
        if (waitForSync) return
        resetSyncWaitTime()
      },
      500
    )
    updateEmitters('addListener')
  },

  all: function (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = defaults(opts || {}, { include_docs: true })
    return bb.resolve(
      this.db.allDocs(opts)
        .then(function getDocs (docs) {
          return docs.rows.reduce(function (r, v) {
            var doc = opts.include_docs ? v.doc : v
            // rework doc format to always have id ==> _id
            if (!opts.include_docs) {
              doc._id = doc.id
              delete doc.id
            }
            if (!opts.includeDesignDocs) r.push(doc)
            else if (opts.includeDesignDocs && doc._id.match(designDocRegex)) r.push(doc)
            return r
          }, [])
        })
    ).asCallback(cb)
  },

  add: function () {
    var cb
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    return bb.resolve(this.save.apply(this, args)).asCallback(cb)
  },

  bulkGet: function (opts, cb) {
    if (Array.isArray(opts)) opts = { docs: opts }
    opts.docs = opts.docs.map(function (doc) {
      // because PouchDB can't make up it's mind, we need
      // to map back to id and rev here
      let nDoc = assign({}, doc)
      if (nDoc._id) nDoc.id = nDoc._id
      if (nDoc._rev) nDoc.rev = nDoc._rev
      delete nDoc._rev
      delete nDoc._id
      return nDoc
    })
    return bb.resolve(
      this.db.bulkGet(opts)
        .then(function (r) {
          return r.results.map(function (docGroup) {
            var doc = get(docGroup, 'docs[0].ok')
            if (!doc) {
              throw new ReferenceError('doc ' + docGroup.id + 'not found')
            }
            return doc
          })
        })
    ).asCallback(cb)
  },

  createIndicies: function (indicies, cb) {
    indicies = Array.isArray(indicies) ? indicies : [indicies]
    return bb.resolve(
      this.db.createIndex({
        index: {
          fields: unique(indicies)
        }
      })
        .catch(function (err) { if (err.status !== 409) throw err })
    ).asCallback(cb)
  },

  clear: function () {
    var cb
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    return bb.resolve(this.deleteAll.apply(this, args)).asCallback(cb)
  },

  delete: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    return bb.resolve(this.db.remove(doc, opts)).asCallback(cb)
  },

  deleteAll: function (cb) {
    return bb.resolve(
      this.all().then(function deleteEach (docs) {
        docs = docs.map(function (doc) { return this.delete(doc) }.bind(this))
        return Promise.all(docs)
      }.bind(this))
    ).asCallback(cb)
  },

  deleteDB: function (cb) { // jshint ignore:line
    return bb.resolve(this.db.destroy()).asCallback(cb)
  },

  update: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = opts || {}
    // http://pouchdb.com/api.html#create_document
    // db.put(doc, [docId], [docRev], [options], [callback])
    return bb.resolve(
      this.db.put(doc, opts._id, opts._rev).then(function (meta) {
        doc._id = meta.id
        doc._rev = meta.rev
        return doc
      })
    ).asCallback(cb)
  },

  save: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    // http://pouchdb.com/api.html#create_document
    // db.post(doc, [docId], [docRev], [options], [callback])
    var method = doc.hasOwnProperty('_id') && (doc._id || doc._id === 0) ? 'put' : 'post'
    return bb.resolve(
      this.db[method](doc).then(function (meta) {
        delete meta.status
        doc._id = meta.id
        doc._rev = meta.rev
        return doc
      })
    ).asCallback(cb)
  },

  // pouchdb-find proxies
  createIndex: function (cb) {
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    return bb.resolve(this.createIndicies.apply(this, args)).asCallback(cb)
  },

  destroy: function (cb) {
    if (this.syncEmitter) {
      this.syncEmitter.cancel()
    }
    return bb.resolve(this.db.destroy.apply(this.db, arguments)).asCallback(cb)
  },

  find: function (opts, cb) {
    return bb.resolve(
      this.db.find(opts).then(function returnDocsArray (rslt) {
        return rslt.docs
      })
    ).asCallback(cb)
  }

})

// proxy pouch methods, and pouch-find methods
var pouchMethods = [
  // proxy pouch instance methods
  'destroy',
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
  if (Pouchy.prototype[method]) { return }
  Pouchy.prototype[method] = function () {
    var cb
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') cb = args.pop()
    return bb.resolve(this.db[method].apply(this.db, args)).asCallback(cb)
  }
})

Pouchy.PouchDB = PouchDB

module.exports = Pouchy
