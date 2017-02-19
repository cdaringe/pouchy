'use strict'

require('perish')
var test = require('tape')
var Pouchy = require('../../')

module.exports = function (opts) {
  opts = opts || {}
  Pouchy.plugin(require('pouchdb-adapter-memory'))

  var pouchyFactory = opts.pouchyFactory || function (opts) { return new Pouchy(opts) }

  var couchdbInvalidName = 'TEsT dB'
  var couchdbInvalidUrl = 'https://www.me.org/eeek/invalidPathname'
  var couchdbInvalidConn = {
    protocol: 'https',
    hostname: 'localhost',
    port: 3001,
    pathname: 'invalidPathname'
  }
  var conn = {
    protocol: 'https',
    hostname: 'localhost',
    port: 3001,
    pathname: 'validpathname'
  }
  var p

  test('constructor', function (t) {
    t.plan(7)

    try {
      p = new Pouchy()
      t.fail('pouchy requires input')
    } catch (err) {
      t.pass('requires args')
    }

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
  })

  test('all, add, save, delete', function (t) {
    var docs = [
      { _id: 'test-doc-1', test: 'will put on `add` with _id' },
      { id: 'test-doc-2', test: 'will post on `add` without _id' },
      { _id: 'test-doc-3', test: 'will put on `save` with _id' },
      { _id: 'test-doc-4', dummyKey: 'dummyVal' }
    ]
    p = pouchyFactory({ name: 'testdb-' + Date.now() })

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

  test('bulkGet', function (t) {
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
    p = pouchyFactory({ name: 'testdb-' + Date.now() })
    t.plan(3)
    p.createIndicies('test')
      .then(function (indexResults) {
        t.pass('indicies created')
        return p.bulkDocs([
          { test: 't1', _id: 'doc1' },
          { test: 't2', _id: 'doc2' }
        ])
      })
      .then(function () {
        return p.find({
          selector: { test: 't2' },
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
    p = pouchyFactory({ name: 'testdb-' + Date.now() })
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
    p = pouchyFactory({ name: 'blah' + Date.now() })
    t.ok(p.info, 'proxied function present')
    t.end()
  })

  test('contructor proxied method', function (t) {
    Pouchy.defaults({
      prefix: '/dummy-prefix',
      adapter: 'memory'
    })
    t.pass('defaults applied')
    t.end()
  })
}
