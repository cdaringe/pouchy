'use strict'

require('perish')
const server = require('./server')
const test = require('tape')
const fs = require('fs')
const cp = require('child_process')
const Pouchy = require('../')
Pouchy.PouchDB
.plugin(require('pouchdb-adapter-leveldb'))
.plugin(require('pouchdb-adapter-memory'))
const path = require('path')
const testDir = path.join(__dirname, './.test-db-dir')
const pouchyFactory = function (opts) {
  if (!opts.path) { opts.path = testDir }
  return new Pouchy(opts)
}
const couchdbInvalidName = 'TEsT dB'
const couchdbInvalidUrl = 'https://www.me.org/eeek/invalidPathname'
const couchdbInvalidConn = {
  protocol: 'https',
  hostname: 'localhost',
  port: 3001,
  pathname: 'invalidPathname'
}
const name = 'test-db-'
const conn = {
  protocol: 'https',
  hostname: 'localhost',
  port: 3001,
  pathname: 'validpathname'
}
const bb = require('bluebird')
bb.config({ warnings: false })

let p

const mkdirp = (dir) => cp.execSync('mkdir -p ' + dir)
const rmrf = (dir) => { try { cp.execSync('rm -rf ' + dir) } catch (err) {} }

const setup = () => {
  rmrf(testDir)
  mkdirp(testDir)
  if (!fs.statSync(testDir).isDirectory) {
    throw new ReferenceError('test dir not generated')
  }
}

const teardown = () => { try { rmrf(testDir) } catch (err) {} }

test('setup', function (t) {
  setup()
  t.end()
})

test('constructor', function (t) {
  t.plan(10)

  try {
    p = new Pouchy()
    t.fail('pouchy requires input')
  } catch (err) {}

  // name requirement
  try {
    pouchyFactory({})
    t.fail('pouchdb didnt have name')
  } catch (err) {
    t.ok(true, 'enforced name')
  }

  p = new Pouchy({ name: 'nameonly', pouchConfig: { adapter: 'memory' } })
  t.ok(p, 'name only db ok')

  // invalid name
  try {
    p = pouchyFactory({ name: couchdbInvalidName })
  } catch (err) {
    t.ok(true, 'Errored on couchdbInvalidName')
  }

  // invalid url
  try {
    pouchyFactory({ name: couchdbInvalidUrl })
  } catch (err) {
    t.ok(true, 'Errored on couchdbInvalidUrl')
  }

  // invalid conn
  try {
    pouchyFactory({ conn: couchdbInvalidConn })
  } catch (err) {
    t.ok(true, 'Errored on couchdbInvalidUrl')
  }

  // conn building url
  var pFail = pouchyFactory({ conn: conn })
  t.ok(pFail.url, 'conn url built successfully')

  var pPath = pouchyFactory({ name: 'ppath' })
  pPath.save({ _id: 'test-path' }, (err, doc) => {
    if (err) { return t.end(err.message) }
    var lstat = fs.lstatSync(path.resolve(testDir, 'ppath'))
    t.ok(lstat.isDirectory, 'construct db in path honored')
  })

  var pSlash = pouchyFactory({ name: 'db/with/slash' })
  t.ok(pSlash, 'allows / in db name')
  pSlash.save({ _id: 'slash-test' }, (err, doc) => {
    if (err) {
      t.pass('forbids writing dbs with slashes/in/name to disk')
      return
    }
    t.end('permitted writing db with slashes/in/db/name to disk')
  })

  // custom path
  var customDir = path.join(__dirname, 'custom-db-path')
  try { rmrf(customDir) } catch (err) {}
  try { mkdirp(customDir) } catch (err) {}
  var pCustomPath = pouchyFactory({
    name: 'custom-dir-db',
    path: customDir
  })
  pCustomPath.save({ _id: 'custom-path-test' }, (err, doc) => {
    if (err) { return t.end(err.message) }
    var customStat = fs.statSync(path.join(customDir, 'custom-dir-db', 'LOG'))
    t.ok(customStat, 'custom db paths')
    try { rmrf(customDir) } catch (err) {}
  })
})

test('basic sync', function (t) {
  t.plan(2)
  var pSync = pouchyFactory({
    url: 'http://www.bogus-sync-db.com/bogusdb',
    replicate: 'sync'
  })
  var __handled = false
  var handleNaughtySyncEvent = function (evt) {
    if (__handled) return
    __handled = true
    t.pass('paused handler (retry default)')
    pSync.destroy()
    .catch(function (err) {
      t.ok(err, 'pauses/errors on destroy on invalid remote db request')
    })
    .then(() => t.end())
    .catch(t.end)
  }
  pSync.syncEmitter.on('paused', handleNaughtySyncEvent)
  pSync.syncEmitter.on('error', handleNaughtySyncEvent)
})

test('advanced sync', function (t) {
  t.plan(2)
  const killP2 = () => { try { cp.execSync('rm -rf ./p2') } catch (err) { /* pass */ } }
  const dbName = 'advancedsync'
  let p2
  killP2()
  server.setup()
  .then(() => {
    const p1 = new Pouchy.PouchDB(server.dbURL(dbName))
    return Promise.resolve()
    .then(() => p1.put({ _id: 'adv-1', data: 1 }))
    .then(() => p1.put({ _id: 'adv-2', data: 2 }))
  })
  .then(() => {
    let res
    const promise = new Promise((resolve) => { res = resolve })
    p2 = new Pouchy({
      name: 'p2',
      replicate: 'sync',
      url: server.dbURL(dbName)
    })
    p2.syncEmitter.on('hasLikelySynced', res)
    return promise
  })
  .then(() => p2.all())
  .then((docs) => {
    p2.syncEmitter.cancel()
    t.equal(docs.length, 2, 'sync cross db ok')
  })
  .then(() => server.teardown())
  .then(() => killP2())
  .then(() => t.pass('teardown'))
  .then(t.end, t.end)
})

test('custom replication inputs sync', function (t) {
  // string `sync` tested above, try objects now
  t.plan(2)
  var pSync = pouchyFactory({
    url: 'http://www.bogus-sync-db.com/bogusdb',
    replicate: { sync: { live: true, heartbeat: 1, timeout: 1 } }
  })
  pSync.syncEmitter.on('error', function () {
    t.pass('syncEmitter enters error on bogus url w/out')
    pSync.destroy()
      .catch(function (err) {
        t.ok(err, 'errors on destroy on invalid remote db request')
      })
      .then(() => t.end())
      .catch(t.end)
  })
})

test('all, add, save, delete', function (t) {
  var docs = [
    { _id: 'test-doc-1', test: 'will put on `add` with _id' },
    { id: 'test-doc-2', test: 'will post on `add` without _id' },
    { _id: 'test-doc-3', test: 'will put on `save` with _id' },
    { _id: 'test-doc-4', dummyKey: 'dummyVal' }
  ]
  p = pouchyFactory({ name: name + Date.now() })

  t.plan(7)
  p.add(docs[0]) // add1
    .then(function checkAdd1 (doc) {
      t.equal(docs[0]._id, doc._id, '.add kept _id via put')
      docs[0] = doc
    })
    .then(function add2 () {
      return p.add(docs[1])
    })
    .then(function checkAdd2 (doc) {
      docs[1] = doc
      t.ok(doc._id.length > 15, ".add gen'd long _id via post")
      t.notEqual(doc._id, 'test-doc-2', 'id not === _id')
    })
    .then(() => p.add(docs[2]))
    .then(() => p.add(docs[3]))
    .then(() => p.all())
    .then((r) => {
      t.equal(r.length, docs.length, 'all, include_docs: true (promise mode)')
      t.equal(r[3].dummyKey, docs[3].dummyKey, 'actual docs returned by .all')
    })
    .then(() => p.all({ include_docs: false }))
    .then((r) => {
      t.equal(r.length, docs.length, 'all, include_docs: false (promise mode)')
    })
    .then(function checkGetAllCallback (r) {
      return new Promise(function (resolve, reject) {
        p.all(function (err, r) {
          if (err) { return reject(err) }
          t.equal(r.length, docs.length, 'same number of docs added come out! (cb mode)')
          return resolve()
        })
      })
    })
    .then(function () {
      return p.delete(docs[0])
    })
    .then(function (result) {
      t.end()
    })
    .catch(function (err) {
      t.fail(err)
      t.end()
    })
})

test('bulkGet', (t) => {
  p = pouchyFactory({ name: 'test_db_' + Date.now() })
  var dummyDocs = [
    { _id: 'a', data: 'a' },
    { _id: 'b', data: 'b' }
  ]
  t.plan(2)
  Promise.resolve()
    .then(() => p.save(dummyDocs[0]))
    .then((doc) => (dummyDocs[0] = doc))
    .then(() => p.save(dummyDocs[1]))
    .then((doc) => (dummyDocs[1] = doc))
    .then(() => {
      // drop doc .data attrs to be thoroughly demonstrative
      const toFetch = dummyDocs.map((dummy) => {
        return { _id: dummy._id, _rev: dummy._rev } // or .id, .rev
      })
      p.bulkGet(toFetch).then((docs) => {
        t.deepEqual(docs, dummyDocs, 'bulkGet returns sane results')
      })
        .then(() => {
          p.bulkGet([{ _id: 'bananas' }])
            .catch((err) => {
              t.ok(err, 'errors when _id not in bulkGet result set')
              t.end()
            })
        })
    })
})

test('indexes & find', function (t) {
  p = pouchyFactory({ name: name + Date.now() })
  t.plan(3)
  p.createIndicies('test')
    .then(function (indexResults) {
      t.pass('indicies created')
      return p.bulkDocs([
        {test: 't1', _id: 'doc1'},
        {test: 't2', _id: 'doc2'}
      ])
    })
    .then(function () {
      return p.find({
        selector: {test: 't2'},
        fields: ['_id']
      })
    })
    .then(function (result) {
      t.equal('doc2', result[0]._id, 'find on index')
    })
    .then(function () { return p.info() })
    .then(function (info) {
      t.ok(info, 'proxy method ok')
      t.end()
    })
    .catch(function (err) {
      t.fail(err.message)
      t.end()
    })
})

test('update', function (t) {
  p = pouchyFactory({ name: name + Date.now() })
  var rev
  t.plan(3)
  return p.add({ test: 'update-test' })
  .then(function (doc) {
    rev = doc._rev
    doc.newField = 'new-field'
    return p.update(doc)
    .then(function (updatedDoc) {
      t.notOk(rev === updatedDoc._rev, 'update updates _rev')
      t.equal('new-field', updatedDoc.newField, 'update actually updates')
    })
  })
  .then(() => p.clear())
  .then(() => p.all())
  .then((docs) => t.equal(0, docs.length, 'docs cleared'))
  .then(t.end)
  .catch(function (err) {
    t.fail(err.message)
    t.end()
  })
})

test('proxies loaded', function (t) {
  p = pouchyFactory({ name: name + Date.now() })
  t.ok(p.info, 'proxied function present')
  t.end()
})

test('prefers db folder named after opts.name vs url /pathname', function (t) {
  setup()
  var opts = {
    name: 'p2',
    url: 'http://www.dummy/couch/p2'
  }
  var p = pouchyFactory(opts)
  t.plan(2)
  p.save({ _id: 'xzy', random: 1 }, (err, doc) => {
    if (err) { return t.end(err.message) }
    t.ok(fs.statSync(path.resolve(testDir, opts.name, 'LOG')), 'db in dir derived from `name`, not url')
    t.equal(p.url, opts.url, 'url remains intact')
    teardown()
    t.end()
  })
})

test('memdown', (t) => {
  t.plan(2)
  setup()
  var memdownOpts = {
    name: 'test-memdown',
    pouchConfig: { adapter: 'memory' }
  }
  var leveldownOpts = {
    name: 'test-leveldown',
    pouchConfig: { db: require('leveldown') }
  }
  var pLeveldown = pouchyFactory(leveldownOpts)
  pLeveldown.save({ _id: '456', data: 'blah' })
    .then(() => {
      try {
        t.ok(
          fs.statSync(path.join(testDir, leveldownOpts.name, 'LOG')),
          'LOG present, memdown disabled'
        )
      } catch (err) {
        throw new Error('expected LOG file when not using memdown')
      }
    })
    .then(() => {
      var pMemdown = pouchyFactory(memdownOpts)
      pMemdown.save({ _id: '123' })
        // test
        .then(() => {
          try {
            fs.statSync(path.resolve(testDir, memdownOpts.name, 'LOG'))
          } catch (err) {
            if (err.code === 'ENOENT') {
              t.ok(err, 'no stores generated when configured for memdown')
              teardown()
              t.end()
              return
            }
          }
          t.end('db dir found when using memdown')
        })
    })
    .catch(t.end)
})

// test('changes', (t) => {
//   // var p = pouchyFactory({ name: 'changesdb' })
//   var p = new Pouchy.PouchDB(path.join(__dirname, './.test-db-dir/changesdb'))
//   t.plan(1)
//   p.changes().on('changed', (info) => {
//     t.pass('info passed')
//     t.end()
//   })
//   p.put({ _id: '123', dummy: 1 })
// })

test('teardown', function (t) {
  t.plan(1)
  teardown()
  t.pass('teardown ok')
  t.end()
})
