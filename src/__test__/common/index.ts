/* eslint no-unused-vars: "off" */
import test from 'blue-tape'
import Pouchy, { PouchyOptions, MaybeSavedPouchDoc } from '../../'
require('perish')

export type TestDbData = {
  id?: string
  rev?: string
  test?: string
}

export default function (opts: any) {
  opts = opts || {}
  Pouchy.plugin(require('pouchdb-adapter-memory'))
  Pouchy.plugin(require('pouchdb-adapter-websql'))
  var pouchyFactory: (...args: any[]) => Pouchy<TestDbData> =
    opts.pouchyFactory ||
    opts.factory ||
    function (opts: PouchyOptions) {
      return new Pouchy<TestDbData>(opts)
    }

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
  var p: Pouchy<TestDbData>

  test('constructor', function (t) {
    t.plan(7)
    try {
      p = new Pouchy(null as any)
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

  test('get, all, add, save, delete', async t => {
    const docs: (TestDbData & MaybeSavedPouchDoc)[] = [
      { _id: 'test-doc-1', test: 'will put on `add` with _id' },
      { id: 'test-doc-2', test: 'will post on `add` without _id' },
      { _id: 'test-doc-3', test: 'will put on `save` with _id' },
      { _id: 'test-doc-4', test: 'dummyVal' }
    ]
    p = pouchyFactory({ name: 'testdb-' + Date.now() })
    const added1 = await p.add(docs[0]) // add1
    t.equal(docs[0]._id, added1._id, '.add kept _id via put')
    docs[0] = added1
    const docGet0 = await p.get(docs[0]._id!)
    t.equals(docs[0]._id, docGet0._id, 'basic get')
    const added2 = await p.add(docs[1])
    docs[1] = added2
    t.notEqual(added2._id, 'test-doc-2', 'id === _id')
    await Promise.all([p.add(docs[2]), p.add(docs[3])])
    let r = await p.all()
    t.equal(r.length, docs.length, 'all, include_docs: true (promise mode)')
    t.equal(r[3].test, docs[3].test, 'actual docs returned by .all')
    r = await p.all({ include_docs: false })
    t.equal(r.length, docs.length, 'all, include_docs: false (promise mode)')
    const deleted = await p.delete(added1)
    t.true(deleted.ok, 'deleted ok')
  })

  test('getMany', async t => {
    p = pouchyFactory({ name: 'test_db_' + Date.now() })
    var dummyDocs: any[] = [{ _id: 'a', data: 'a' }, { _id: 'b', data: 'b' }]
    return Promise.resolve()
      .then(() => p.getMany(null as any))
      .catch(err => t.ok(err.message.match(/getMany/)))
      .then(() => p.getMany({} as any))
      .catch(err => t.ok(err.message.match(/getMany/)))
      .then(() => p.getMany([]))
      .then(docs => t.equal(docs.length, 0, 'empty set passed on getMany'))
      .then(() => p.save(dummyDocs[0]))
      .then(doc => (dummyDocs[0] = doc))
      .then(() => p.save(dummyDocs[1]))
      .then(doc => (dummyDocs[1] = doc))
      .then(() =>
        dummyDocs.map(dummy => ({ _id: dummy._id, _rev: (dummy as any)._rev }))
      )
      .then(toFetch => p.getMany(toFetch as any))
      .then(docs =>
        t.deepEqual(docs, dummyDocs, 'getMany returns sane results')
      )
      .then(() => p.getMany([{ _id: 'bananas' }]))
      .catch(err => t.ok(err, 'errors when _id not in getMany result set'))
  })

  test('indicies & find', async t => {
    p = pouchyFactory({ name: 'testdb-indicies-' + Date.now() })
    const index: any = await p.upsertIndex('testSingleIndex')
    t.ok(index.name, 'single index ok')
    const indexResults = await p.createIndicies('test')
    await p.createIndicies('test') // prove that it won't error
    t.ok(indexResults, 'indicies created')
    const bulkRes = await p.bulkDocs([
      { test: 't1', _id: 'doc1' },
      { test: 't2', _id: 'doc2' }
    ])
    t.ok(bulkRes.length === 2, '2 docs bulk added')
    t.ok(bulkRes[0]._id, '_id transformed on pouch native proxied call')
    const result = await p.findMany({
      selector: { test: 't2' },
      fields: ['_id']
    })
    t.equal('doc2', result[0]._id, 'find on index')
    const info = await p.info()
    t.ok(info, 'proxy method ok')
    t.ok(info.db_name, 'info reports back db_name')
  })

  test('update', async t => {
    p = pouchyFactory({ name: 'testdb-' + Date.now() })
    var rev: string
    t.plan(3)
    const doc = await p.add({ test: 'update-test' })
    rev = doc._rev
    doc.test = 'new-value'
    const updatedDoc = await p.update(doc)
    t.notOk(rev === updatedDoc._rev, 'update updates _rev')
    t.equal(updatedDoc.test, 'new-value', 'update actually updates')
    await p.clear()
    const docs = await p.all()
    t.equal(0, docs.length, 'docs cleared')
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
