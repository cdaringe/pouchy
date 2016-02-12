'use strict';
var test = require('tape');
var P = require('../');
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
var fs = require('fs.extra');
var connUrl = 'https://localhost:3001'
var path = require('path');
var p;

test('constructor', function(t) {
    t.plan(8);

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

    var pSlash = new P({ name: 'db/with/slash', path: './test/' });
    t.ok(pSlash, 'allows / in db name');
    // custom paths and syncing
    try {
        fs.mkdirSync('test/custompath');
    } catch(err) {
        // pass
    }

    var pSync = new P({
        url: 'http://www.bogus-sync-db.com/bogusdb',
        path: './test/custompath',
        replicate: 'both'
    });
    pSync.info().catch(function(err) {
        t.ok(err, 'errors on invalid remote db request');
    }).catch(function(err) {
        t.fail(err.message);
    });

});



test('all, add, save, delete', function(t) {
    var docs = [
        {_id: 'test-doc-1', test: 'will put on `add` with _id'},
        {id: 'test-doc-2', test: 'will post on `add` without _id'},
        {_id: 'test-doc-3', test: 'will put on `save` with _id'},
        {_id: 'test-doc-4', dummyKey: 'dummyVal'}
    ];
    p = new P({ name: name + Date.now() });

    t.plan(6);
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
    .then(function checkGetAllPromise(r) {
        t.equal(r.length, docs.length, 'same number of docs added come out! (promise mode)');
        t.equal(r[3].dummyKey, docs[3].dummyKey,  'actual docs returned by .all');
    })
    .then(function checkGetAllCallback(r) {
        return new Promise(function(res, rej) {
            p.all(function(err, r) {
                if (err) { return rej(err); }
                t.equal(r.length, docs.length, 'same number of docs added come out! (cb mode)');
                return res();
            });
        });
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

test('pefers db folder named after opts.name vs url /pathname', function(t) {
    var dbName = 'p2';
    var dbDir = './test-db-dir';
    var destUrl = 'http://www.dummy/couch/p1/' + dbName;
    try {
        fs.rmrf(dbDir);
        fs.mkdirpSync(dbDir);
    } catch(err) {}
    var p = new P({
        name: dbName,
        path: dbDir,
        url: destUrl
    });
    t.plan(2)
    p.save({ _id: 'xzy' }).then(doc => {
        t.ok(fs.lstatSync(path.resolve(dbDir, dbName, 'LOG')), 'db in dir derived from `name`, not url');
        t.equal(p.url, destUrl, 'url remains intact');
        try { fs.rmrf(dbDir); } catch(err) {}
        t.end();
    }).catch(err => {
        t.fail(err);
        t.end();
    });
});
