/* eslint no-unused-vars: "off" */
/**
 * @module Pouchy
 */
import { toUnderscorePrefix } from './to-underscore-prefix'
import adapterFind from 'pouchdb-find'
import adapterHttp from 'pouchdb-adapter-http'
import adapterReplication from 'pouchdb-replication'
import defaults from 'lodash/defaults'
import get from 'lodash/get'
import isNil from 'lodash/isNil'
import path from 'path'
import PouchDB from 'pouchdb-core'
import unique from 'lodash/uniq'
import url, { UrlObject } from 'url'

PouchDB.plugin(adapterHttp)
  .plugin(adapterFind)
  .plugin(adapterReplication)

export type MaybeSavedPouchDoc = {
  _id?: PouchDB.Core.DocumentId
  _rev?: PouchDB.Core.RevisionId
}

export type SavedPouchDoc = {
  _id: PouchDB.Core.DocumentId
  _rev: PouchDB.Core.RevisionId
}

/**
 * @private
 */
type FirstArgument<T> = T extends (arg1: infer U, ...args: any[]) => any
  ? U
  : any

export const couchUrlify = (url: string) =>
  url.replace(/[^/a-z0-9_$()+-]/gi, '')
export const POUCHY_API_DOCS_URI = 'https://cdaringe.github.io/pouchy'

export type PouchyOptions = {
  conn?: UrlObject // creates `url` using the awesome and simple [url.format](https://www.npmjs.com/package/url#url-format-urlobj)
  couchdbSafe?: boolean // default: true. asserts that `name` provided or `url` provided will work with couchdb.  tests by asserting str conforms to [couch specs](https://wiki.apache.org/couchdb/HTTP_database_API#Naming_and_Addressing), minus the `/`.  This _may complain that some valid urls are invalid_.  Please be aware and disable if necessary.
  name?: string // name of db. recommended for most dbs. calculated from derived url string if `conn` or `url` provided. otherwise, required
  path?: string // path to store db on filesystem, if using a filesystem adapter.  defaults to _PouchDB_'s default of `cwd` if not specified
  pouchConfig?: PouchDB.Configuration.DatabaseConfiguration // PouchDB constructor input [options](http://pouchdb.com/api.html#create_database). be mindful of pouchy options you set, because they may comingle :)
  /**
   * in object form you can try `{ out/in/sync: ... }` where ... refers to the
   * [official PouchDB replication options](http://pouchdb.com/api.html#replication). in string form, simply provide
   * 'out/in/sync'. please note that the string shorthand applies default
   * heartbeat/retry options.
   */
  replicate?:
    | string
    | {
        out?: PouchDB.Replication.ReplicateOptions
        in?: PouchDB.Replication.ReplicateOptions
        sync?: PouchDB.Replication.ReplicateOptions
      }
  replicateLive?: boolean // default: true.  activates only if `replicate` is set
  url?: string // url to remote CouchDB. user may use the `conn` option instead as well
}

export class Pouchy<Content = {}> {
  static PouchDB = PouchDB
  static plugin = PouchDB.plugin
  static defaults = PouchDB.defaults
  static debug = PouchDB.debug

  // tap into your instance's replication `changes()` so you may listen to events.
  // calling `.destroy` will scrap this emitter. emitter only present when
  // `replicate` options intially provided
  public syncEmitter:
    | PouchDB.Replication.Replication<Content>
    | PouchDB.Replication.Sync<Content>
    | null = null

  public db: PouchDB.Database<Content> // internal PouchDB instance
  public hasLocalDb: boolean
  public isEnforcingCouchDbSafe: boolean
  public url: string | null
  public path: string | null
  private _replicationOpts: PouchDB.Replication.ReplicateOptions | null = null

  constructor (opts: PouchyOptions) {
    this._validatePouchyOpts(opts)
    this.isEnforcingCouchDbSafe = isNil(opts.couchdbSafe)
      ? true
      : opts.couchdbSafe
    this.url = this._getUrlFromOpts(opts)
    this.hasLocalDb = !!opts.name
    /* istanbul ignore next */
    if (!this.url && !this.hasLocalDb) {
      throw new Error('remote database requires url')
    }
    this.name = this.hasLocalDb
      ? this._setDbNameFromOpts(opts)
      : this._setDbNameFromUri(this.url!)
    if (this.isEnforcingCouchDbSafe) this._validateDbName()
    this.path = this.hasLocalDb
      ? path.resolve(opts.path || '', this.name)
      : null
    this.db = new PouchDB<Content>(
      opts.name ? this.path! : this.url!,
      opts.pouchConfig
    )
    if (opts.replicate) this._handleReplication(opts.replicate)
  }

  /**
   * @private
   */
  _validatePouchyOpts (opts: PouchyOptions) {
    if (!opts || (!opts.name && (!opts.url && !opts.conn))) {
      throw new ReferenceError(
        [
          'missing pouchy database paramters.  please see: ' +
            POUCHY_API_DOCS_URI +
            '\n',
          '\tif you are creating a local database (browser or node), provide a `name` key.\n',
          '\tif you are just using pouchy to access a remote database, provide a `url` or `conn` key\n',
          '\tif you are creating a database to replicate with a remote database, provide a',
          '`url` or `conn` key, plus a replicate key.\n'
        ].join('')
      )
    }
    /* istanbul ignore next */
    if (opts.url && opts.conn) {
      throw new ReferenceError('provide only a `url` or `conn` option')
    }
    /* istanbul ignore next */
    if (!this) {
      throw new ReferenceError('no `this` context.  did you forget `new`?')
    }
  }

  /**
   * @private
   */
  _handleReplication (opts: PouchyOptions['replicate']) {
    var replOpts: PouchDB.Replication.ReplicateOptions
    var mode: string
    /* istanbul ignore next */
    if (!this.url) {
      throw new ReferenceError('url or conn object required to replicate')
    }
    /* istanbul ignore else */
    if (typeof opts === 'string') {
      mode = opts
      replOpts = { live: true, retry: true }
    } else if (opts) {
      mode = Object.keys(opts)[0]
      /* istanbul ignore else */
      if (mode in opts) {
        replOpts = (opts as any)[mode]
      } else {
        throw new Error(`mode "${mode}" is not a valid replication option`)
      }
    } else {
      throw new Error('invalid replication options')
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
        throw new Error(
          [
            "in/out replication direction must be specified, got '",
            mode + "'"
          ].join(' ')
        )
    }
  }

  /**
   * @private
   */
  _getUrlFromOpts (opts: PouchyOptions) {
    if (!isNil(opts.url)) return opts.url
    if (!isNil(opts.conn)) return url.format(opts.conn)
    return null
  }

  /**
   * @private
   */
  _setDbNameFromUri (uri: string) {
    const pathname = url.parse(uri).pathname // eslint-disable-line
    /* istanbul ignore next */
    if (!pathname && !this.name) {
      throw new Error(
        [
          'unable to infer database name from uri. try adding a pathname',
          'to the uri (e.g. host.org/my-db-name) or pass a `name` option'
        ].join(' ')
      )
    }
    var pathParts = (pathname || '').split('/')
    this.name = this.name || pathParts[pathParts.length - 1]
    return this.name
  }

  /**
   * @private
   */
  _setDbNameFromOpts (opts: PouchyOptions) {
    /* istanbul ignore next */
    if (!opts.name) {
      throw new Error('local pouchy database requires a `name` field')
    }
    return opts.name
  }

  /**
   * @private
   */
  _validateDbName () {
    var couchDbSafeName = couchUrlify(this.name.toLowerCase())
    if (this.name === couchDbSafeName) return
    throw new Error(
      [
        'database name may not be couchdb safe.',
        '\tunsafe name: ' + this.name,
        '\tsafe name: ' + couchDbSafeName
      ].join('\n')
    )
  }

  /**
   * add a document to the db.
   * @see save
   * @example
   * // with _id
   * const doc = await p.add({ _id: 'my-sauce', bbq: 'sauce' })
   * console.log(doc._id, doc._rev, doc.bbq); // 'my-sauce', '1-a76...46c', 'sauce'
   *
   * // no _id
   * const doc = await p.add({ peanut: 'butter' })
   * console.log(doc._id, doc._rev, doc.peanut); // '66188...00BF885E', '1-0d74...7ac', 'butter'
   */
  add (doc: Content & MaybeSavedPouchDoc): Promise<Content & SavedPouchDoc> {
    return this.save.apply(this, arguments as any)
  }

  /**
   * get all documents from db
   * @example
   * const docs = await p.all()
   * console.log(`total # of docs: ${docs.length}!`))
   *
   * @example
   * const docs = await p.all({ includeDesignDocs: true })
   */
  async all (
    allOpts?: FirstArgument<PouchDB.Database<Content>['allDocs']>
  ): Promise<(Content & SavedPouchDoc)[]> {
    const opts = defaults(allOpts || {}, { include_docs: true })
    const docs = await this.db.allDocs(opts)
    return docs.rows.reduce(function simplifyAllDocSet (r, v) {
      var doc: any = opts.include_docs ? v.doc : v
      // rework doc format to always have id ==> _id
      if (!opts.include_docs) {
        doc._id = doc.id
        doc._rev = doc.value.rev
        delete doc.id
        delete doc.value
        delete doc.key
      }
      ;(r as any).push(doc)
      return r
    }, [])
  }

  /**
   * The native bulkGet PouchDB API is not very user friendly.
   * In fact, it's down right wacky!
   * This method patches PouchDB's `bulkGet` and assumes that _all_ of your
   * requested docs exist.  If they do not, it will error via the usual error
   * control flows.
   *
   * @example
   * // A good example of what you can expect is actually right out of the tests!
   * let dummyDocs = [
   *   { _id: 'a', data: 'a' },
   *   { _id: 'b', data: 'b' }
   * ]
   * Promise.resolve()
   * .then(() => p.save(dummyDocs[0])) // add our first doc to the db
   * .then((doc) => (dummyDocs[0] = doc)) // update our closure doc it knows the _rev
   * .then(() => p.save(dummyDocs[1]))
   * .then((doc) => (dummyDocs[1] = doc))
   * .then(() => {
   *   // prepare getMany query (set of { _id, _rev}'s are required)
   *   const toFetch = dummyDocs.map(dummy => ({
   *     _id: dummy._id,
   *     _rev: dummy._rev
   *     // or you can provide .id, .rev
   *   }))
   *   p.getMany(toFetch)
   *     .then((docs) => {
   *       t.deepEqual(docs, dummyDocs, 'getMany returns sane results')
   *       t.end()
   *     })
   * })
   * @param {object|array} opts array of {_id, _rev}s, or { docs: [ ... } } where
   *                            ... is an array of {_id, _rev}s
   * @param {function} [cb]
   */
  async getMany (
    docMetas: { _id: string; _rev?: string | undefined }[]
  ): Promise<(Content & SavedPouchDoc)[]> {
    /* istanbul ignore else */
    if (!docMetas || !Array.isArray(docMetas)) {
      throw new Error('getMany: missing doc metadatas')
    }
    const opts = {
      docs: docMetas.map(function remapIdRev (lastDoc: any) {
        const doc = { ...lastDoc }
        // we need to map back to id and rev here
        /* istanbul ignore else */
        if (doc._id) doc.id = doc._id
        /* istanbul ignore else */
        if (doc._rev) doc.rev = doc._rev
        delete doc._rev
        delete doc._id
        return doc
      })
    }
    if (!opts.docs.length) return Promise.resolve([])
    const r = await this.db.bulkGet(opts)
    return r.results.map(function tidyBulkGetDocs (docGroup) {
      var doc = get(docGroup, 'docs[0].ok')
      if (!doc) {
        throw new ReferenceError('doc ' + docGroup.id + 'not found')
      }
      return doc
    })
  }

  /**
   * easy way to create a db index.
   * @see createIndicies
   * @example
   * await p.upsertIndex('myIndex')
   */
  upsertIndex (indexName: string) {
    return this.createIndicies.apply(this, arguments as any)
  }

  /**
   * allow single or bulk creation of indicies. also, doesn't flip out if you've
   * already set an index.
   * @example
   * const indicies = await p.createIndicies('test')
   * console.dir(indicies)
   * // ==>
   * [{
   *     id: "_design/idx-28933dfe7bc072c94e2646126133dc0d"
   *     name: "idx-28933dfe7bc072c94e2646126133dc0d"
   *     result: "created"
   * }]
   */
  createIndicies (indicies: string | string[]) {
    indicies = Array.isArray(indicies) ? indicies : [indicies]
    return (
      this.db
        .createIndex({ index: { fields: unique(indicies) } })
        /* istanbul ignore next */
        .catch(function handleFailCreateIndicies (err) {
          /* istanbul ignore next */
          if (err.status !== 409) throw err
        })
    )
  }

  /**
   * @see deleteAll
   * @returns {Promise}
   */
  clear () {
    return this.deleteAll.apply(this, arguments as any)
  }

  /**
   * delete a document.
   * @example
   * // same as pouch.remove
   * const deleted = await p.delete(doc)
   * console.dir(deleted)
   * // ==>
   * {
   *     id: "test-doc-1"
   *     ok: true
   *     rev: "2-5cf6a4725ed4b9398d609fc8d7af2553"
   * }
   */
  delete (doc: PouchDB.Core.RemoveDocument, opts?: PouchDB.Core.Options) {
    return this.db.remove(doc, opts)
  }

  /**
   * clears the db of documents. under the hood, `_deleted` flags are added to docs
   */
  async deleteAll () {
    var deleteSingleDoc = (doc: any) => this.delete(doc)
    const docs = await this.all()
    return Promise.all(docs.map(deleteSingleDoc))
  }

  /**
   * Destroys the database.  Proxies to pouchdb.destroy after completing
   * some internal cleanup first
   */
  async destroy () {
    /* istanbul ignore next */
    if (this.syncEmitter && !(<any>this.syncEmitter).canceled) {
      let isSyncCancelledP = Promise.resolve()
      if (this._replicationOpts && this._replicationOpts.live) {
        // early bind the `complete` event listener.  careful not to bind it
        // inside the .then, otherwise binding happens at the end of the event
        // loop, which is too late! `.cancel` is a sync call!
        isSyncCancelledP = new Promise((resolve, reject) => {
          if (!this.syncEmitter) {
            return reject(new Error('syncEmitter not found'))
          }
          this.syncEmitter.on('complete' as any, () => {
            resolve()
          })
        })
      }
      this.syncEmitter.cancel() // will trigger a `complete` event
      await isSyncCancelledP
    }
    return this.db.destroy()
  }

  /**
   * Similar to standard pouchdb.find, but returns simple set of results
   */
  async findMany (
    opts: FirstArgument<PouchDB.Find.FindRequest<Content>>
  ): Promise<(Content & SavedPouchDoc)[]> {
    const rslt = await this.db.find(opts)
    return rslt.docs
  }

  /**
   * update a document, and get your sensibly updated doc in return.
   *
   * @example
   * const doc = await p.update({ _id: 'my-doc', _rev: '1-abc123' })
   * console.log(doc)
   * // ==>
   * {
   *    _id: 'my-doc',
   *    _rev: '2-abc234'
   * }
   * @param {object} doc
   * @param {function} [cb]
   * @returns {Promise}
   */
  async update (
    doc: FirstArgument<PouchDB.Database<Content>['put']>
  ): Promise<Content & SavedPouchDoc> {
    // http://pouchdb.com/api.html#create_document
    // db.put(doc, [docId], [docRev], [options], [callback])
    const meta = await this.db.put(doc)
    doc._id = meta.id
    doc._rev = meta.rev
    return doc as any
  }

  /**
   * Adds or updates a document.  If `_id` is set, a `put` is performed (basic add operation). If no `_id` present, a `post` is performed, in which the doc is added, and large-random-string is assigned as `_id`.
   * @example
   * const doc = await p.save({ beep: 'bop' })
   * console.log(doc)
   * // ==>
   * {
   *   _id: 'AFEALJW-234LKJASDF-2A;LKFJDA',
   *   _rev: '1-asdblkue242kjsa0f',
   *   beep: 'bop'
   * }
   */
  async save (
    doc: Content & MaybeSavedPouchDoc
  ): Promise<Content & SavedPouchDoc> {
    // http://pouchdb.com/api.html#create_document
    // db.post(doc, [docId], [docRev], [options], [callback])
    /* istanbul ignore next */
    var method =
      Object.prototype.hasOwnProperty.call(doc, '_id') &&
      (doc._id || (doc as any)._id === 0)
        ? 'put'
        : 'post'
    const meta =
      method === 'put'
        ? await this.db.put(doc as any)
        : await this.db.post(doc as any)
    delete (meta as any).status
    doc._id = meta.id
    doc._rev = meta.rev
    return doc as any
  }

  /**
   * START POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   * START POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   * START POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   */

  /**
   * database name
   */
  name: string

  /* istanbul ignore next */
  /** Fetch all documents matching the given options. */
  allDocs<Model> (
    options?:
      | PouchDB.Core.AllDocsWithKeyOptions
      | PouchDB.Core.AllDocsWithKeysOptions
      | PouchDB.Core.AllDocsWithinRangeOptions
      | PouchDB.Core.AllDocsOptions
  ) {
    return {} as Promise<PouchDB.Core.AllDocsResponse<Content & Model>>
  }

  /* istanbul ignore next */
  /**
   * Create, update or delete multiple documents. The docs argument is an array of documents.
   * If you omit an _id parameter on a given document, the database will create a new document and assign the ID for you.
   * To update a document, you must include both an _id parameter and a _rev parameter,
   * which should match the ID and revision of the document on which to base your updates.
   * Finally, to delete a document, include a _deleted parameter with the value true.
   */
  bulkDocs<Model> (
    docs: Array<PouchDB.Core.PutDocument<Content & Model>>,
    options?: PouchDB.Core.BulkDocsOptions
  ) {
    return {} as Promise<Array<SavedPouchDoc>>
  }

  /* istanbul ignore next */
  /** Compact the database */
  compact (options?: PouchDB.Core.CompactOptions) {
    return {} as Promise<PouchDB.Core.Response>
  }

  /* istanbul ignore next */
  /** Fetch a document */
  get<Model> (
    docId: PouchDB.Core.DocumentId,
    options?: PouchDB.Core.GetOptions
  ) {
    return {} as Promise<
      PouchDB.Core.Document<Content & Model> & PouchDB.Core.GetMeta
    >
  }

  /* istanbul ignore next */
  /**
   * Create a new document without providing an id.
   *
   * You should prefer put() to post(), because when you post(), you are
   * missing an opportunity to use allDocs() to sort documents by _id
   * (because your _ids are random).
   *
   * @see {@link https://pouchdb.com/2014/06/17/12-pro-tips-for-better-code-with-pouchdb.html|PouchDB Pro Tips}
   */
  post<Model> (
    doc: PouchDB.Core.PostDocument<Content & Model>,
    options?: PouchDB.Core.Options
  ) {
    return {} as Promise<PouchDB.Core.Response>
  }

  /* istanbul ignore next */
  /**
   * Create a new document or update an existing document.
   *
   * If the document already exists, you must specify its revision _rev,
   * otherwise a conflict will occur.
   * There are some restrictions on valid property names of the documents.
   * If you try to store non-JSON data (for instance Date objects) you may
   * see inconsistent results.
   */
  put<Model> (
    doc: PouchDB.Core.PutDocument<Content & Model>,
    options?: PouchDB.Core.PutOptions
  ) {
    return {} as Promise<PouchDB.Core.Response>
  }

  /* istanbul ignore next */
  /** Remove a doc from the database */
  remove (doc: PouchDB.Core.RemoveDocument, options?: PouchDB.Core.Options) {
    return {} as Promise<PouchDB.Core.Response>
  }

  /* istanbul ignore next */
  /** Get database information */
  info () {
    return {} as Promise<PouchDB.Core.DatabaseInfo>
  }

  /* istanbul ignore next */
  /**
   * A list of changes made to documents in the database, in the order they were made.
   * It returns an object with the method cancel(), which you call if you don’t want to listen to new changes anymore.
   *
   * It is an event emitter and will emit a 'change' event on each document change,
   * a 'complete' event when all the changes have been processed, and an 'error' event when an error occurs.
   * Calling cancel() will unsubscribe all event listeners automatically.
   */
  changes<Model> (options?: PouchDB.Core.ChangesOptions) {
    return {} as PouchDB.Core.Changes<Content & Model>
  }

  /* istanbul ignore next */
  /** Close the database */
  close () {
    return {} as Promise<void>
  }

  /* istanbul ignore next */
  /**
   * Attaches a binary object to a document.
   * This method will update an existing document to add the attachment, so it requires a rev if the document already exists.
   * If the document doesn’t already exist, then this method will create an empty document containing the attachment.
   */
  putAttachment (
    docId: PouchDB.Core.DocumentId,
    attachmentId: PouchDB.Core.AttachmentId,
    attachment: PouchDB.Core.AttachmentData,
    type: string
  ) {
    return {} as Promise<PouchDB.Core.Response>
  }

  /* istanbul ignore next */
  /** Get attachment data */
  getAttachment (
    docId: PouchDB.Core.DocumentId,
    attachmentId: PouchDB.Core.AttachmentId,
    options?: { rev?: PouchDB.Core.RevisionId }
  ) {
    return {} as Promise<Blob | Buffer>
  }

  /* istanbul ignore next */
  /** Delete an attachment from a doc. You must supply the rev of the existing doc. */
  removeAttachment (
    docId: PouchDB.Core.DocumentId,
    attachmentId: PouchDB.Core.AttachmentId,
    rev: PouchDB.Core.RevisionId
  ) {
    return {} as Promise<PouchDB.Core.RemoveAttachmentResponse>
  }

  /* istanbul ignore next */
  /** Given a set of document/revision IDs, returns the document bodies (and, optionally, attachment data) for each ID/revision pair specified. */
  bulkGet<Model> (options: PouchDB.Core.BulkGetOptions) {
    return {} as Promise<PouchDB.Core.BulkGetResponse<Content & Model>>
  }

  /* istanbul ignore next */
  /** Given a set of document/revision IDs, returns the subset of those that do not correspond to revisions stored in the database */
  revsDiff (diff: PouchDB.Core.RevisionDiffOptions) {
    return {} as Promise<PouchDB.Core.RevisionDiffResponse>
  }
  /**
   * END POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   * END POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   * END POUCHDB IMPLEMENTATIONS FOR MIXIN SUPPORT
   */
}

/**
 * @private
 * call Pouchy or native PouchDB methods and transform all repsonses to
 * unify ids & revs
 */
/* istanbul ignore next */
const nonTransformingPrototype: any = {}
/* istanbul ignore next */
for (const key of Object.getOwnPropertyNames(Pouchy.prototype)) {
  const value = (Pouchy.prototype as any)[key]
  if (
    typeof value !== 'function' ||
    (value && value.name === 'Pouchy') ||
    (value && value.name && value.name[0] === '_')
  ) {
    continue
  }
  nonTransformingPrototype[key] = value
  ;(Pouchy.prototype as any)[key] = async function transformResponse (
    ...args: any[]
  ) {
    let res = nonTransformingPrototype[key].call(this, ...args)
    if (res && res.then && res.catch) res = await res
    if (typeof args[args.length - 1] === 'function') {
      throw new Error(
        [
          'the pouchy-pouchdb callback interface has been removed.',
          'please use the promise interface.'
        ].join(' ')
      )
    }
    return toUnderscorePrefix(res)
  }
}

export const pouchProxyMethods = [
  'bulkDocs',
  'bulkGet',
  'changes',
  'close',
  'compact',
  'get',
  'getAttachment',
  'info',
  'post',
  'put',
  'putAttachment',
  'remove',
  'removeAttachment',
  'revsDiff'
]
for (const key of pouchProxyMethods) {
  const value = PouchDB.prototype[key]
  /* istanbul ignore next */
  if (!value) throw new Error(`pouchdb method "${key}" not found`)
  /* istanbul ignore next */
  if (typeof value !== 'function') continue
  ;(Pouchy.prototype as any)[key] = async function proxyAndTransform (
    ...args: any[]
  ) {
    const pouchMethod: Function = PouchDB.prototype[key]
    let res = pouchMethod.call(this.db, ...args)
    if (res && res.then && res.catch) res = await res
    /* istanbul ignore next */
    if (typeof args[args.length - 1] === 'function') {
      throw new Error(
        [
          'the pouchy-pouchdb callback interface has been removed.',
          'please use the promise interface.'
        ].join(' ')
      )
    }
    return toUnderscorePrefix(res)
  }
}

export default Pouchy
