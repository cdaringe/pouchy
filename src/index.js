'use strict'

var bluebird = require('bluebird')
var path = require('path')
var adapterHttp = require('pouchdb-adapter-http')
var adapterFind = require('pouchdb-find')
var adapterReplication = require('pouchdb-replication')
var PouchDbCore = require('pouchdb-core')
var PouchDB = PouchDbCore.default || PouchDbCore
PouchDB
.plugin(adapterHttp.default || adapterHttp)
.plugin(adapterFind.default || adapterFind)
.plugin(adapterReplication.default || adapterReplication)
PouchDB.utils = { promise: bluebird }
var privateMethods = require('./private')
var publicMethods = require('./public')

var assign = require('lodash/assign')
var isNil = require('lodash/isNil')
var toArray = require('lodash/toArray')

/**
 * @namespace
 * @property Pouchy.PouchDB
 * tap into the PouchDB constructor via Pouchy
 */

/**
 * @event hasLikelySynced
 * @description if your database is replicating, you may want to know
 * if your newly instantiated DB instance has finished a first attempt of
 * synchronization.  this is incredibly helpful if you need to
 * wait for a full replication to finish, even if you are replicating in `live`
 * mode, in which case you will never receive a `complete` event!
 * make sure to `.syncEmitter.on('error', ...)` too when using this event.
 */

/**
 * @class
 * @property {PouchDB} db reference to PouchDB instance under the pouchy hood!
 * @property {EventEmitter} syncEmitter tap into your instance's replication `changes()` so you may listen to events. calling `.destroy` will scrap this emitter. emitter only present when `replicate` options intially provided
 * @property {string} name db name, always has one!
 * @property {boolean} verbose verbose mode, as applicable
 * @property {string} url url of remote db, as applicable
 * @property {string} path fully qualified path for local copy of db either _is_ or would be stored (no files written if { pouchConfig: { db: 'memdown' } }, for example.
 * @param {object} opts
 * @param {string}  [opts.name] name of db. recommended for most dbs. calculated from derived url string if `conn` or `url` provided. otherwise, required
 * @param {object}  [opts.conn] creates `url` using the awesome and simple [url.format](https://www.npmjs.com/package/url#url-format-urlobj)
 * @param {boolean} [opts.couchdbSafe] [default: true] asserts that `name` provided or `url` provided will work with couchdb.  tests by asserting str conforms to [couch specs](https://wiki.apache.org/couchdb/HTTP_database_API#Naming_and_Addressing), minus the `/`.  This _may complain that some valid urls are invalid_.  Please be aware and disable if necessary.
 * @param {string}  [opts.url] url to remote CouchDB
 * @param {string}  [opts.path] path to store pouch on filesystem, if using on filesystem!  defaults to _PouchDB_'s default of `cwd` if not specified
 * @param {object}  [opts.pouchConfig] PouchDB constructor [options](http://pouchdb.com/api.html#create_database). be mindful of pouchy options you set, because they may comingle :)
 * @param {string|object}  [opts.replicate] [default: undefined] in object form you can try `{ out/in/sync: ... }` where ... refers to the  [official PouchDB replication options](http://pouchdb.com/api.html#replication). in string form, simply provide 'out/in/sync'. please note that the string shorthand applies default heartbeat/retry options.
 * @param {boolean} [opts.replicateLive] [default: true] activates only if `replicate` is set
 * @param {boolean} [opts.verbose] yak out text to console. note, this does _not_ enable PouchDB.debug.enable(...) verbosity.  Use Pouchy.PouchDB.debug to set that per your own desires!
 */
function Pouchy (opts) {
  this._validatePouchyOpts(opts)
  this.isEnforcingCouchDbSafe = isNil(opts.couchdbSafe) ? true : opts.couchdbSafe
  this.verbose = isNil(opts.verbose) ? false : opts.verbose
  this.url = this._getUrlFromOpts(opts)
  this.hasLocalDb = !!opts.name
  this.name = this.hasLocalDb
    ? this._setDbNameFromOpts(opts)
    : this._setDbNameFromUri(this.url)
  if (this.isEnforcingCouchDbSafe) this._validateDbName()
  if (this.hasLocalDb) this.path = path.resolve(opts.path || '', this.name)
  this.db = new PouchDB(opts.name ? this.path : this.url, opts.pouchConfig)
  if (opts.replicate) this._handleReplication(opts.replicate)
}

assign(Pouchy.prototype, privateMethods, publicMethods)

// proxy pouch methods, and pouch-find methods
var pouchInstanceMethods = [
  // proxy pouch instance methods
  'put',
  'post',
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
  'compact',
  'revsDiff',
  // proxy pouchdb-find methods
  // 'createIndex' => see methods above
  'getIndexes',
  'deleteIndex'
// 'find' => see methods above
]

var pouchConstructorMethods = [
  'debug',
  'defaults',
  'plugin'
]

/**
 * @private
 */
/* istanbul ignore next */
var proxyInstanceMethods = function (method) {
  if (Pouchy.prototype[method]) { return }
  Pouchy.prototype[method] = function () {
    var args = toArray(arguments)
    var cb
    if (typeof args[args.length - 1] === 'function') cb = args.pop()
    var val = this.db[method].apply(this.db, args)
    var rtn
    if (val instanceof bluebird || val instanceof Promise) {
      rtn = bluebird.resolve(val)
      if (cb) rtn.asCallback(cb)
      return rtn
    }
    return val
  }
}
pouchInstanceMethods.forEach(proxyInstanceMethods)

/**
 * @private
 */
var proxyConstructorMethods = function (method) {
   /* istanbul ignore next */
  if (Pouchy[method]) { return }
  Pouchy[method] = function proxyConstructorMethod () {
    return PouchDB[method].apply(PouchDB, arguments)
  }
}
pouchConstructorMethods.forEach(proxyConstructorMethods)

Pouchy.PouchDB = PouchDB

module.exports = Pouchy
