'use strict';
var test = require('tape');
var Pouchy = require('../');
var fs = require('fs.extra');
var path = require('path');
var testDir = path.join(__dirname, './.test-db-dir');
var pouchyFactory = function(opts) {
  if (!opts.path) { opts.path = testDir; }
  return new Pouchy(opts);
};
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
var connUrl = 'https://localhost:3001'
var p;

test('setup', function(t) {
    try { fs.mkdirSync(testDir); } catch(err) {};
    t.end();
});

test('constructor', function(t) {
    t.plan(10);

    // name requirement
    try {
        var p = new pouchyFactory({});
        t.fail('pouchdb didnt have name');
    } catch(err) {
        t.ok(true, 'enforced name');
    }

    // invalid name
    try {
        p = new pouchyFactory({ name: couchdbInvalidName });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidName');
    }

    // invalid url
    try {
        p = new pouchyFactory({ name: couchdbInvalidUrl });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidUrl');
    }

    // invalid conn
    try {
        p = new pouchyFactory({ conn: couchdbInvalidConn });
    } catch(err) {
        t.ok(true, 'Errored on couchdbInvalidUrl');
    }

    // conn building url
    var pFail;
    try {
        pFail = new pouchyFactory({ conn: conn });
    } catch(err) {
        // pass, expected to fail
    }
    t.ok(pFail.url, 'conn url built successfully');


    var pPath = new pouchyFactory({ name: 'ppath' });
    pPath.save({ _id: 'test-path'}, (err, doc) => {
        if (err) {
            t.fail(err);
            t.end()
        }
        var lstat = fs.lstatSync(path.resolve(testDir, 'ppath'));
        t.ok(lstat.isDirectory, 'construct db in path honored');
    });

    var pSlash = new pouchyFactory({ name: 'db/with/slash' });
    t.ok(pSlash, 'allows / in db name');
    pSlash.save({ _id: 'slash-test'}, (err, doc) => {
        if (err) {
            t.pass('forbids writing dbs with slashes/in/name to disk');
            return;
        }
        t.fail('permitted writing db with slashes/in/db/name to disk');
        t.end();

    });

    // custom path
    var customDir = path.join(__dirname, 'custom-db-path');
    try { fs.rmrfSync(customDir); } catch(err) {}
    try { fs.mkdirSync(customDir); } catch(err) {}
    var pCustomPath = new pouchyFactory({
        name: 'custom-dir-db',
        path: customDir,
    });
    pCustomPath.save({ _id: 'custom-path-test' }, (err, doc) => {
        if (err) {
            t.fail(err);
            t.end();
            return;
        }
        var customStat = fs.statSync(path.join(customDir, 'custom-dir-db', 'LOG'));
        t.ok(customStat, 'custom db paths');
        try { fs.rmrfSync(customDir); } catch(err) {}
    });

    var pSync = new pouchyFactory({
        url: 'http://www.bogus-sync-db.com/bogusdb',
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
    p = new pouchyFactory({ name: name + Date.now() });

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
    p = new pouchyFactory({ name: name + Date.now() });
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
    p = new pouchyFactory({ name: name + Date.now() });
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
    p = new pouchyFactory({ name: name + Date.now() });
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
    var p = new pouchyFactory({
        name: dbName,
        path: dbDir,
        url: destUrl
    });
    t.plan(2)
    p.save({ _id: 'xzy' }).then(doc => {
        debugger
        t.ok(fs.lstatSync(path.resolve(dbDir, dbName, 'LOG')), 'db in dir derived from `name`, not url');
        t.equal(p.url, destUrl, 'url remains intact');
        try { fs.rmrf(dbDir); } catch(err) {}
        t.end();
    }).catch(err => {
        t.fail(err);
        t.end();
    });
});

test('teardown', function(t) {
    try { fs.rmrf(testDir); } catch(err) {};
    t.end();
});
