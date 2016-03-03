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
var couchUrlify = function (str) {
  return str.replace(/[^/a-z0-9_$()+-]/gi, '')
}

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
  var replicate = opts.replicate
  var couchdbSafe = opts.couchdbSafe === undefined ? true : opts.couchdbSafe
  var pathParts
  var _url // temp url used during validation cycle
  var live // eslint-disable-line

  if (!opts) {
    throw new ReferenceError('db options required')
  }
  if (!opts.name && !opts.url && !opts.conn) {
    throw new ReferenceError('db name, url, or conn required to create or access pouchdb')
  }
  if (!this) { throw new ReferenceError('no `this` context.  did you forget `new`?') }

  if (opts.url) {
    _url = opts.url
  } else if (opts.conn) {
    _url = url.format(opts.conn)
  }

  if (_url) {
    pathParts = url.parse(_url).pathname.split('/')
    // check opts.name, as name may have / in it
    this.name = opts.name || pathParts[pathParts.length - 1]
    if (couchdbSafe && this.name !== couchUrlify(this.name.toLowerCase())) {
      throw new Error([
        'provided `url` or `conn` "',
        ((opts.conn && JSON.stringify(opts.conn)) || _url),
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

  if (_url) {
    this.url = _url
  }
  this.path = path.resolve(opts.path || '', this.name)

  this.db = new PouchDB(
    opts.name ? this.path : this.url,
    opts.pouchConfig
  )
  if (replicate) {
    if (!this.url) {
      throw new ReferenceError('url or conn object required to replicate')
    }
    replicate = replicate === 'both' ? 'sync' : replicate
    live = (opts.replicateLive === undefined) ? true : opts.replicateLive
    switch (replicate) {
      case 'out':
        this.syncEmitter = this.db.replicate.to(this.url, { live: true, retry: true })
        break
      case 'in':
        this.syncEmitter = this.db.replicate.from(this.url, { live: true, retry: true })
        break
      case 'sync':
        this.syncEmitter = this.db.sync(this.url, { live: true, retry: true })
        break
      default:
        throw new Error('in/out replication direction ' +
          'must be specified')
    }
  }
}

assign(Pouchy.prototype, {
  all: function (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = defaults(opts || {}, {
      include_docs: true // jshint ignore:line
    })
    var p = this.db.allDocs(opts)
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
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  add: function () {
    var cb
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    var p = this.save.apply(this, args)
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  bulkGet: function (opts, cb) {
    if (Array.isArray(opts)) opts = { docs: opts }
    opts.docs = opts.docs.map((doc) => {
      // because PouchDB can't make up it's mind, we need
      // to map back to id and rev here
      let nDoc = assign({}, doc)
      if (nDoc._id) nDoc.id = nDoc._id
      if (nDoc._rev) nDoc.rev = nDoc._rev
      delete nDoc._rev
      delete nDoc._id
      return nDoc
    })
    var p = this.db.bulkGet(opts)
      .then((r) => {
        return r.results.map((docGroup) => {
          const doc = get(docGroup, 'docs[0].ok')
          if (!doc) {
            throw new ReferenceError('doc ' + docGroup.id + 'not found')
          }
          return doc
        })
      })
    if (!cb) return p
    p.then(
      (r) => cb(null, r),
      (err) => cb(err, null)
    )
  },

  createIndicies: function (indicies, cb) {
    indicies = Array.isArray(indicies) ? indicies : [indicies]
    var p = this.db.createIndex({
      index: {
        fields: unique(indicies)
      }
    })
      .catch(function (err) {
        if (err.status !== 409) {
          throw err
        }
      })
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  clear: function () {
    var cb
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    var p = this.deleteAll.apply(this, args)
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  delete: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    var p = this.db.remove(doc, opts)
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  deleteAll: function (cb) {
    var p = this.all().then(function deleteEach (docs) {
      docs = docs.map(function (doc) { return this.delete(doc) }.bind(this))
      return Promise.all(docs)
    }.bind(this))
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  deleteDB: function (cb) { // jshint ignore:line
    var p = this.db.destroy()
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  update: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    opts = opts || {}
    // http://pouchdb.com/api.html#create_document
    // db.put(doc, [docId], [docRev], [options], [callback])
    var p = this.db.put(doc, opts._id, opts._rev).then(function (meta) {
      doc._id = meta.id
      doc._rev = meta.rev
      return doc
    })
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  save: function (doc, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }
    // http://pouchdb.com/api.html#create_document
    // db.post(doc, [docId], [docRev], [options], [callback])
    var method = doc.hasOwnProperty('_id') ? 'put' : 'post'
    var p = this.db[method](doc).then(function (meta) {
      delete meta.status
      doc._id = meta.id
      doc._rev = meta.rev
      return doc
    })
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  // pouchdb-find proxies
  createIndex: function (cb) {
    var args = toArray(arguments)
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    var p = this.createIndicies.apply(this, args)
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  },

  destroy: function () {
    if (this.syncEmitter) this.syncEmitter.cancel()
    if (this.changesEmitter) this.changesEmitter.cancel()
    this.db.destroy.apply(this.db, arguments)
  },

  find: function (opts, cb) {
    var p = this.db.find(opts).then(function returnDocsArray (rslt) {
      return rslt.docs
    })
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
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
    if (typeof args[args.length - 1] === 'function') {
      cb = args.pop()
    }
    var p = this.db[method].apply(this.db, args)
    if (!cb) { return p }
    p.then(
      function (r) { cb(null, r) },
      function (err) { cb(err, null) }
    )
  }
})

Pouchy.PouchDB = PouchDB

module.exports = Pouchy
