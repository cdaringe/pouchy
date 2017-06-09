'use strict'

require('perish')

var path = require('path')
var server = require('./server')
var test = require('tape')
var fs = require('fs-extra')
var Pouchy = require('../../')
var common = require('../common')

var {
  factory,
  mkdir,
  rmrf,
  setup,
  teardown,
  testDir
} = require('./util')

test('setup', t => {
  t.plan(1)
  return setup().then(() => t.pass('intial test setup'))
})

common({ factory })

test('ondisk db', t => {
  t.test('basic pathing', t => {
    t.plan(1)
    var name = 'test_path_as_relative_db_name'
    return factory({ name })
    .save({ _id: 'test-path' })
    .then(() => fs.lstat(path.resolve(testDir, name)))
    .then(lstat => t.ok(lstat.isDirectory, 'db path honored'))
    .then(() => t.end, t.end)
  })

  t.test('custom pathing', t => {
    var customDir = path.join(__dirname, 'custom-db-path')
    t.plan(1)
    return rmrf(customDir)
    .then(() => mkdir(customDir))
    .then(() => factory({ name: 'custom-dir-db', path: customDir }))
    .then(db => db.save({ _id: 'custom-path-test' }))
    .then(() => fs.stat(path.join(customDir, 'custom-dir-db', 'LOG')))
    .then(stat => t.ok(stat, 'custom db paths'))
    .then(() => rmrf(customDir))
    .then(() => t.end, t.end)
  })

  t.test('gracefully handle slashes', t => {
    t.plan(2)
    var name = 'db/with/slash'
    var db = factory({ name })
    t.equals(db.name, name, 'allows / in db name')
    return db.save({ _id: 'slash-test' })
    .then(() => t.end('permitted writing db with slashes/in/db/name to disk'))
    .catch(() => t.pass('forbids writing dbs with slashes/in/name to disk'))
    .then(() => t.end, t.end)
  })
})

test('sync', t => {
  t.test('syncEmitter emits errors', t => {
    t.plan(2)
    var url = 'http://www.bogus-sync-db.com/bogusdb'
    var db = factory({ url, replicate: 'sync' })
    var handled = false
    var handleNaughtySyncEvent = function (evt) {
      if (handled) return
      handled = true
      t.pass('paused handler (retry default)')
      return db.destroy()
      .catch(err => t.ok(err, 'pauses/errors on destroy on invalid remote db request'))
      .then(() => t.end(), t.end)
    }
    db.syncEmitter.on('paused', handleNaughtySyncEvent)
    db.syncEmitter.on('error', handleNaughtySyncEvent)
  })

  t.test('custom replication options', t => {
    t.plan(2)
    var url = 'http://www.bogus-sync-db.com/bogusdb'
    var replicate = { sync: { live: true, heartbeat: 1, timeout: 1 } }
    var db = factory({ url, replicate })
    return db.syncEmitter.on('error', () => {
      t.pass('syncEmitter enters error on bogus url w/out')
      return db.destroy()
      .catch(err => t.ok(err, 'errors on destroy on invalid remote db request'))
      .then(() => t.end(), t.end)
    })
  })

  t.test('advanced sync', t => {
    t.plan(2)
    var localDbName = 'advancedsynclocal'
    var remoteDbName = 'advancedsyncremote'
    var dbLocal
    return Promise.resolve()
    .then(() => rmrf(`./${localDbName}`))
    .then(() => server.setup())
    .then(() => {
      var dbRemote = new Pouchy({ url: server.dbURL(remoteDbName), adapter: 'memory' })
      return Promise.resolve()
      .then(() => dbRemote.put({ _id: 'adv-1', data: 1 }))
      .then(() => dbRemote.put({ _id: 'adv-2', data: 2 }))
    })
    .then(() => {
      var res
      var promise = new Promise((resolve) => { res = resolve })
      dbLocal = new Pouchy({
        name: localDbName,
        replicate: 'sync',
        url: server.dbURL(remoteDbName)
      })
      dbLocal.syncEmitter.on('hasLikelySynced', res)
      return promise
    })
    .then(() => dbLocal.all())
    .then(docs => t.equal(docs.length, 2, 'sync cross db ok'))
    .then(() => dbLocal.destroy())
    .then(() => server.teardown())
    .then(() => rmrf(`./${localDbName}`))
    .then(() => t.pass('teardown'))
    .then(t.end, t.end)
  })
})


test('prefers db folder named after opts.name vs url /pathname', t => {
  var name = 'test_db'
  var opts = {
    name,
    url: 'http://www.dummy/couch/p2',
    verbose: true
  }
  var db
  t.plan(2)
  return Promise.resolve()
  .then(() => setup())
  .then(() => { db = factory(opts) })
  .then(() => db.save({ _id: 'xzy', random: 1 }))
  .then(res => {
    var dbStat = fs.statSync(path.resolve(testDir, opts.name, 'LOG'))
    t.ok(dbStat, 'db in dir derived from `name`, not url')
    t.equal(db.url, opts.url, 'url remains intact')
    return teardown()
  })
  .then(() => t.end(), t.end)
})

test('memdown', t => {
  var memdownOpts = {
    name: 'test-memdown',
    pouchConfig: { adapter: 'memory' }
  }
  var leveldownOpts = {
    name: 'test-leveldown',
    pouchConfig: { db: require('leveldown') }
  }
  var pLeveldown
  var pMemdown
  t.plan(2)
  return setup()
  .then(() => { pLeveldown = factory(leveldownOpts) })
  .then(() => pLeveldown.save({ _id: '456', data: 'blah' }))
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
  .then(() => { pMemdown = factory(memdownOpts) })
  .then(() => pMemdown.save({ _id: '123' }))
  .then(() => {
    try {
      fs.statSync(path.resolve(testDir, memdownOpts.name, 'LOG'))
    } catch (err) {
      if (err.code === 'ENOENT') {
        return t.ok(err, 'no stores generated when configured for memdown')
      }
    }
    t.end('db dir found when using memdown')
  })
  .then(() => teardown())
  .then(() => t.end(), t.end)
})
