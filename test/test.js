'use strict';
var test = require('tape');
var P = require('../index.js');
var couchdbInvalidName = 'TEsT dB';
var couchdbInvalidUrl = 'https://www.me.org/eeek/invalidPathname';
var couchdbValidUrl = 'https://www.me.org/eeek/invalidPathname';
var couchdbInvalidConn = {
    protocol: 'https',
    hostname: 'localhost',
    port: 3001,
    pathname: 'invalidPathname'
};
var name = 'test-db-';
var conn = {
    protocol: 'https',
    hostname: 'localhost',
    port: 3001,
    pathname: 'validpathname'
};
var fs = require('fs');
var connUrl = 'https://localhost:3001'
var p;

test('constructor', function(t) {
    t.plan(6);

    // name requirement
    try {
        var p = new P({});
        t.fail('pouchdb didnt have name');
    } catch(err) {
        t.ok(true, 'enforced name');
    }

    // invalid name
    try {
        p = new P({ name: couchdbInvalidName });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidName');
    }

    // invalid url
    try {
        p = new P({ name: couchdbInvalidUrl });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidUrl');
    }

    // invalid conn
    try {
        p = new P({ conn: couchdbInvalidConn });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidUrl');
    }

    // conn building url
    var pFail;
    try {
        pFail = new P({ conn: conn });
    } catch(err) {
        // pass, expected to fail
    }
    t.ok(pFail.url, 'conn url built successfully');

    var pPath = new P({ name: 'ppath', path: './test/' });
    t.ok(fs.lstatSync('test/ppath').isDirectory, 'construct db in path honored');

    t.end();
});



test('all, add, save, delete', function(t) {
    var docs = [
        {_id: 'test-doc-1', test: 'will put on `add` with _id'},
        {id: 'test-doc-2', test: 'will post on `add` without _id'},
        {_id: 'test-doc-3', test: 'will put on `save` with _id'},
        {_id: 'test-doc-4', dummyKey: 'dummyVal'}
    ];
    p = new P({ name: name + Date.now() });

    t.plan(5);
    p.add(docs[0]) // add1
    .then(function checkAdd1(doc) {
        t.equal(docs[0]._id, doc._id, '.add kept _id via put');
        docs[0] = doc;
    })
    .then(function add2() {
        return p.add(docs[1]);
    })
    .then(function checkAdd2(doc) {
        docs[1] = doc;
        t.ok(doc._id.length > 15, '.add gen\'d long _id via post');
        t.notEqual(doc._id, 'test-doc-2', 'id not === _id');
    })
    .then(function add3() {
        return p.add(docs[2]);
    })
    .then(function add4(doc) {
        return p.add(docs[3]);
    })
    .then(function getAll() {
        return p.all();
    })
    .then(function checkGetAll(r) {
        t.equal(r.length, docs.length, 'same number of docs added come out!');
        t.equal(r[3].dummyKey, docs[3].dummyKey,  'actual docs returned by .all');
    })
    .then(function() {
        return p.delete(docs[0]);
    })
    .then(function(result) {
        t.end();
    })
    .catch(function(err) {
        t.fail(err);
        t.end();
    });
});

test('indexes & find', function(t) {
    p = new P({ name: name + Date.now() });
    t.plan(2);
    p.createIndicies('test')
        .then(function(indexResults) {
            t.pass('indicies created');
            return p.db.bulkDocs([
              {test: 't1', _id: 'doc1'},
              {test: 't2', _id: 'doc2'}
            ]);
        })
        .then(function() {
            return p.find({
                selector: {test: 't2'},
                fields: ['_id'],
            });
        })
        .then(function(result) {
            t.equal('doc2', result[0]._id, 'find on index');
            t.end();
        })
        .catch(function(err) {
            t.fail(err.message);
            t.end();
        })
});

test('update', function(t) {
    p = new P({ name: name + Date.now() });
    var rev;
    t.plan(3);
    return p.add({test: 'update-test'})
        .then(function(doc) {
            rev = doc._rev;
            doc.newField = 'new-field';
            return p.update(doc)
                .then(function(updatedDoc) {
                    t.notOk(rev === updatedDoc._rev, 'update updates _rev');
                    t.equal('new-field', updatedDoc.newField, 'update actually updates');
                });
        })
        .then(function() {
            return p.clear();
        })
        .then(function() {
            return p.all();
        })
        .then(function(docs) {
            t.equal(0, docs.length, 'docs cleared');
        })
        .then(t.end)
        .catch(function(err) {
            t.fail(err.message);
            t.end();
        });
});

test('proxies loaded', function(t) {
    p = new P({ name: name + Date.now() });
    t.ok(p.info, 'proxied function present');
    t.end();
});
