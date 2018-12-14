# pouchy

[ ![Codeship Status for cdaringe/pouchy](https://codeship.com/projects/723a9160-4203-0133-3599-062894ba1566/status?branch=master)](https://codeship.com/projects/103658) [![Coverage Status](https://coveralls.io/repos/github/cdaringe/pouchy/badge.svg?branch=master)](https://coveralls.io/github/cdaringe/pouchy?branch=master)

[![NPM](https://nodei.co/npm/pouchy.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/pouchy/) [![Greenkeeper badge](https://badges.greenkeeper.io/cdaringe/pouchy.svg)](https://greenkeeper.io/)

## what

> [_"Pouchy is the sugar API for PouchDB that I've been hoping someone would write"_](https://twitter.com/nolanlawson/status/647224028529299456)
> @nolanlawson


simple, enhanced [PouchDB](https://github.com/pouchdb/pouchdb).  `Pouchy` wraps & extends `PouchDB` and provides various sorely needed sugar methods.  further, it assists by standardizing the returned document format.  most methods provided are _very_ simple PouchDB-native method modifiers, but are targeted to save you frequent boilerplate re-typing!  this library also proxies the PouchDB API directly, so you can use it like a PouchDB instance itself!

## how

api docs and examples officially live [here!](http://cdaringe.github.io/pouchy/)

however, here are some basic examples:

```js
// local, node database
const Pouchy = require('pouchy')
const level = require('pouchdb-adapter-leveldb')
Pouchy.plugin(level)

const fruit = new Pouchy({ name: 'fruit' })
fruit
.save({ type: 'orange', tastes: 'delicious' })
.then((orange) => console.log(orange))

/**
  {
    type: 'orange',
    tastes: 'delicious',
    _id: 'EA1F2B55-2482-89C6-907E-6F938C59F734',
    _rev: '1-f60b9b7d775a89d280e1f4c07122b863'
  }
*/
```

```js
// local & remote replicated database!
const Pouchy = require('pouchy')
const memory = require('pouchdb-adapter-memory')
Pouchy.plugin(memory)

const customers = new Pouchy({
  name: 'customers',
  replicate: 'sync',
  url: 'http://mydomain.org/db/customers'
})
customers.save({ firstName: 'bill', lastName: 'brasky' })
// wait for it... and couchdb/pouchdb-server @ http://mydomain.org/db/customers
// will receive bill brasky!
```

## why

why use `pouchy` over `pouchdb`?

- because managing `_id` and `_rev` can be seriously obnoxious with pouchdb (no hard feelings, of course).
  - pouchdb methods return document `_id`s and `_rev`s inconsistently.  some methods return docs with an `id` attribute.  some return docs with `_id`.  the same happens for `rev`.
  - different methods return `_rev` nested under _other attributes_, vs. being at the top of the document.
  - pouchy lets you get your documents back _in the same way they are represented in the store_.  if you are expecting an `_id` and a `_rev` in a return result, you'll get those attributes back on the top of your documents, every time.
- because you need some frequently used sugar methods that aren't keys-included from pouchdb.  **there are many sugar methods available**, make sure to check out the API docs!
    - e.g. `.all()`, to get all full documents in your store, in a simple array.
    - e.g. `.clear()/.deleteAll()` to purge your store of its docs.
- because you want `.find` to return simply an array of docs!
  - note: pouchy pre-loads the `pouchdb-find` plugin, which is super handy and regularly recommended for use.
- because you want to pre-define \*ouchdb synchronization behavior on construction!  start syncing pronto, declaratively!

"Hey, are those alone sufficient justification to wrap pouchdb?"

Yea, it's definitely subjective, but my team and i have answered that powerfully with a "yes, definitely!"

Thanks! [cdaringe](http://cdaringe.com/)

# changelog
- 12.0.0
  - refactor all of the things!
    - better handle all `rev/id` ==> `_rev/_id` mapping
    - **if `rev` or `id` exist on docs returned from pouch exist, but no `_rev` or `_id` exist, that particular kv pair will be moved to the `_`-prefixed key and the non prefixed key will be removed**.
  - more tests!
- 11.0.2
  - drop es6 content. es5 friendly-ify!
- 11.0.0
  - pouchdb 6.0.5!
- 10.1.0
  - expose replication options via `getReplicationOptions`
  - on `destroy`, _actually_ destroy gracefully.  that means, don't resolve the promise/callback until `live` dbs have all http requests fully settled. see [here](https://github.com/pouchdb/express-pouchdb/issues/316#issuecomment-241247448) for more info.
- 10.0.4 - be compatible with latest bluebird `.asCallback`.
- 10.0.0 - migrate to PouchDB 5.4.x.  @NOTE, some APIs are not available by default anymore.  See [the custom build](https://pouchdb.com/custom.html) blog post on how to add features to your pouch `Pouchy.PouchDB.plugin(...)`.  The following plugins are available by default:
  - pouchdb-adapter-http
  - pouchdb-find
  - pouchdb-replication
- 9.0.2 - fix `bulkGet` when no docs are provided
- 9.0.0-1
  - fix `.all({ include_docs: false })` to properly handle `.rev/._rev`
  - improve docs!
- 8.0.5 - fix issues w/ promise/cbs. sorry for 8.0.x-8.0.5 churn!
- 8.0.0 - support cb & promise interface.  added bluebird to make this seamless and less verbose
- 7.1.0 - add `hasLikelySynced` event
- 7.0.0 - modify replicate API.  dropped `'both'` sync option, added `{}` option.  dropped `replicateLive`
- 6.3.0 - add `destroy`, which `.cancel`s any replication from `.syncEmitter` (see `replicate`). deprecate 6.2.0-1. changeEmitter => syncEmitter (rapid patch, so no major bump)
- 6.2.1 - add `this.syncEmitter` when using the `replicate` API
- 6.1.0 - add `bulkGet`
- 6.0.6 - fix issue where `_id` was still `id` when doing `.all({ include_docs: false })`
- 6.0.4 - fix replication issue where db backend not honored
- 6.0.0 - db will store locally via leveldown as `name` if passed. `url` will still be used for replication if requested.  prior versions preferred `url` to the Pouch constructor over name
- 5.2.1 - permit / in couchdb db name
- 5.2.0 - bump with couch
- 5.1.0 - deps bump & add cb interface
- 5.0.0 - deps bump only.  ~~all future releases with track major version #s with PouchDB~~
- 4.0.0 - major bump with PouchDB
- 3.0.0 - remove default `changes`, and associated `on/off`. didn't work out-of-the-box anyway.  may return in 4.x
- 2.0.1 - Don't modify constructor opts.name
- 2.0.0 - Fix synced db `fs` location. Previously was not honoring `path` option
- 1.0.0 - 2.0.1 pouchdb-wrapper => pouchy
