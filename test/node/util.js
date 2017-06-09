'use strict'

var bb = require('bluebird')
var path = require('path')
var Pouchy = require('../../')
var fs = require('fs-extra')

// load node test plugins
bb.config({ warnings: false })
Pouchy.PouchDB
.plugin(require('pouchdb-adapter-leveldb'))
.plugin(require('pouchdb-adapter-memory'))

var util = {
  factory (opts) {
    if (!opts.path) opts.path = this.testDir
    return new Pouchy(opts)
  },
  mkdir: dir => {
    if (dir[0] === '.') dir = path.join(__dirname, dir)
    return fs.mkdirp(dir)
  },
  rmrf (dir) {
    return this.mkdir(dir).then(() => fs.remove(dir))
  },
  setup () {
    return this.rmrf(this.testDir)
    .then(() => this.mkdir(this.testDir))
  },
  teardown () { return this.rmrf(this.testDir) },
  testDir: path.join(__dirname, './_test-db-dir')
}

for (var k in util) {
  if (typeof util[k] === 'function') {
    console.log(k)
    util[k] = util[k].bind(util)
  }
}

module.exports = util
