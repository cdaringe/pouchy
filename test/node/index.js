'use strict'

require('perish')
var server = require('./server')
var test = require('tape')
var fs = require('fs')
var cp = require('child_process')
var Pouchy = require('../../')
var common = require('../common')
Pouchy.PouchDB
  .plugin(require('pouchdb-adapter-leveldb'))
  .plugin(require('pouchdb-adapter-memory'))
var path = require('path')
var testDir = path.join(__dirname, './.test-db-dir')
var pouchyFactory = function (opts) {
  if (!opts.path) { opts.path = testDir }
  return new Pouchy(opts)
}

var bb = require('bluebird')
bb.config({ warnings: false })

var mkdirp = (dir) => cp.execSync('mkdir -p ' + dir)
var rmrf = (dir) => { try { cp.execSync('rm -rf ' + dir) } catch (err) { } }
var setup = () => {
  rmrf(testDir)
  mkdirp(testDir)
  if (!fs.statSync(testDir).isDirectory) {
    throw new ReferenceError('test dir not generated')
  }
}
var teardown = () => { try { rmrf(testDir) } catch (err) { } }

// begin tests

test('setup', function (t) {
  setup()
  t.end()
})

common({ pouchyFactory: pouchyFactory })

test('db written to expected paths', function (t) {
  t.plan(4)

  // on disk db, no custom pathing
  var pPath = pouchyFactory({ name: 'ppath' })
  pPath.save({ _id: 'test-path' }, (err, doc) => {
    if (err) { return t.end(err.message) }
    var lstat = fs.lstatSync(path.resolve(testDir, 'ppath'))
    t.ok(lstat.isDirectory, 'db path honored')
  })

  // on disk db, has custom pathing
  var customDir = path.join(__dirname, 'custom-db-path')
  try { rmrf(customDir) } catch (err) { }
  try { mkdirp(customDir) } catch (err) { }
  var pCustomPath = pouchyFactory({
    name: 'custom-dir-db',
    path: customDir
  })
  pCustomPath.save({ _id: 'custom-path-test' }, (err, doc) => {
    if (err) { return t.end(err.message) }
    var customStat = fs.statSync(path.join(customDir, 'custom-dir-db', 'LOG'))
    t.ok(customStat, 'custom db paths')
    try { rmrf(customDir) } catch (err) { }
  })

  // handle /'s
  var pSlash = pouchyFactory({ name: 'db/with/slash' })
  t.ok(pSlash, 'allows / in db name')
  pSlash.save({ _id: 'slash-test' }, (err, doc) => {
    if (err) {
      t.pass('forbids writing dbs with slashes/in/name to disk')
      return
    }
    t.end('permitted writing db with slashes/in/db/name to disk')
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

test('advanced sync', function (t) {
  t.plan(2)
  var killP2 = () => { try { cp.execSync('rm -rf ./p2') } catch (err) { /* pass */ } }
  var dbName = 'advancedsync'
  let p2
  killP2()
  server.setup()
    .then(() => {
      var p1 = new Pouchy.PouchDB(server.dbURL(dbName))
      return Promise.resolve()
        .then(() => p1.put({ _id: 'adv-1', data: 1 }))
        .then(() => p1.put({ _id: 'adv-2', data: 2 }))
    })
    .then(() => {
      let res
      var promise = new Promise((resolve) => { res = resolve })
      p2 = new Pouchy({
        name: 'p2',
        replicate: 'sync',
        url: server.dbURL(dbName)
      })
      p2.syncEmitter.on('hasLikelySynced', res)
      return promise
    })
    .then(() => p2.all())
    .then((docs) => t.equal(docs.length, 2, 'sync cross db ok'))
    .then(() => p2.destroy())
    .then(() => server.teardown())
    .then(() => killP2())
    .then(() => t.pass('teardown'))
    .then(t.end, t.end)
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

test('memdown', function (t) {
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

test('teardown', function (t) {
  t.plan(1)
  teardown()
  t.pass('teardown ok')
  t.end()
})
