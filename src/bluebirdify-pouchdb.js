'use strict'

var bb = require('bluebird')
var __Promise = global.Promise
global.Promise = bb
var PouchDB = require('pouchdb')
PouchDB.utils.Promise = bb
global.Promise = __Promise
PouchDB.plugin(require('pouchdb-find'))
module.exports = PouchDB
