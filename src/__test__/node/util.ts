/* eslint no-unused-vars: "off" */
import { TestDbData } from '../common'
import bb from 'bluebird'
import fs from 'fs-extra'
import path from 'path'
import Pouchy, { PouchyOptions } from '../../' // eslint-disable-line
import level from 'pouchdb-adapter-leveldb'
// load node test plugins
bb.config({ warnings: false })
Pouchy.PouchDB.plugin(level).plugin(require('pouchdb-adapter-memory'))

export const factory = function (opts: PouchyOptions) {
  if (!opts.path) opts.path = testDir
  opts.couchdbSafe = true
  return new Pouchy<TestDbData>(opts)
}
export const mkdir = (dir: string) =>
  fs.mkdirp(dir[0] === '.' ? path.join(__dirname, dir) : dir)
export const rmrf = (dir: string) => mkdir(dir).then(() => fs.remove(dir))
export const setup = () => rmrf(testDir).then(() => mkdir(testDir))
export const teardown = () => rmrf(testDir)
export const testDir = path.join(__dirname, './_testdb-dir')
export function timeoutDeferred () {
  const deferred = bb.defer()
  const timeout = setTimeout(
    () => deferred.reject(new Error('timeout')),
    (process.env.NODE_ENV || '').match(/dev/) ? 30000 : 4000
  )
  return {
    promise: deferred.promise,
    resolve: (value?: any) => {
      clearTimeout(timeout)
      deferred.resolve(value)
    },
    reject: deferred.reject
  }
}
