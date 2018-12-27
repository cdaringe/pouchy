import {
  factory,
  mkdir,
  rmrf,
  setup,
  timeoutDeferred,
  teardown,
  testDir
} from './util'
import common from '../common'
import fs from 'fs-extra'
import path from 'path'
import test from 'blue-tape'
require('perish')

test('setup', async t => {
  await setup()
  t.pass('intial test setup')
})

common({ factory })

test('ondisk db', t => {
  t.test('basic pathing', async t => {
    var name = 'test_path_as_relative_db_name'
    await factory({ name }).save({ _id: 'test-path' })
    const lstat = await fs.lstat(path.resolve(testDir, name))
    t.ok(lstat.isDirectory, 'db path honored')
  })

  t.test('custom pathing', async t => {
    var customDir = path.join(__dirname, 'custom-db-path')
    await rmrf(customDir)
    await mkdir(customDir)
    const db = factory({ name: 'custom-dir-db', path: customDir })
    await db.save({ _id: 'custom-path-test' })
    const stat = await fs.stat(path.join(customDir, 'custom-dir-db', 'LOG'))
    t.ok(stat, 'custom db paths')
    await rmrf(customDir)
  })

  t.test('gracefully handle slashes', async t => {
    var name = 'db/with/slash'
    var db = factory({ name })
    t.equals(db.name, name, 'allows / in db name')
    try {
      await db.save({ _id: 'slash-test' })
      return t.end('permitted writing db with slashes/in/db/name to disk')
    } catch (err) {
      t.pass('forbids writing dbs with slashes/in/name to disk')
    }
  })
})

test('sync', t => {
  t.test('syncEmitter emits errors', async t => {
    const deferred = timeoutDeferred()
    var url = 'http://www.bogus-sync-db.com/bogusdb'
    var db = factory({ url, replicate: 'sync' })
    var handled = false
    var handleNaughtySyncEvent = function (evt: any) {
      if (handled) return
      handled = true
      t.pass('paused handler (retry default)')
      return db.destroy().catch((err: any) => {
        t.equals(
          err.code,
          'ENOTFOUND',
          'pauses/errors on destroy on invalid remote db request'
        )
        deferred.resolve()
      })
    }
    db.syncEmitter!.on('paused', handleNaughtySyncEvent)
    db.syncEmitter!.on('error', handleNaughtySyncEvent)
    return deferred.promise
  })

  t.test('custom replication options', async t => {
    var url = 'http://www.bogus-sync-db.com/bogusdb'
    var replicate = { sync: { live: true, heartbeat: 1, timeout: 1 } }
    var db = factory({ url, replicate })
    const deferred = timeoutDeferred()
    db.syncEmitter!.on('error', async () => {
      t.pass('syncEmitter enters error on bogus url w/out')
      try {
        await db.destroy()
      } catch (err) {
        t.equals(
          err.code,
          'ENOTFOUND',
          'errors on destroy on invalid remote db request'
        )
        deferred.resolve()
      }
    })
    return deferred.promise
  })
})

test('teardown', async t => {
  await teardown()
  t.pass('tests teardown')
})
