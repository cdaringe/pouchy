'use strict'

/**
 * @module test-pool-utils
 * @description X-PipelineRunnerPool is a highly integrated abstraction,
 * requiring serveral layers of instantiated components within.  Although many
 * of the components could be stubbed (Runners/Pipelines/Registries), the value
 * of this abstraction is essentially the orchestration of said components.
 * Thus, the best way to acheive coverage for PipelineRunnerPools is to provide
 * minimially stubbed subcomponents in order to assert proper orchestration.
 * this module brings a virtual db server online, provisions registries, and
 * offers basic helpers to assist in PipelineRunnerPool testing.
 *
 * @warning this component may share state between tests.  ensure that your tests
 * utilize varying dbs and computations as necessary to minimize test
 * co-dependencies
 *
 */

'use strict'

const url = require('url')

const config = {
  backend: false, // e.g. memdown
  config: { file: false },
  log: { file: false },
  port: 5989,
  timeout: 10000, // in ms
  verbose: false
}

const pdbs = require('spawn-pouchdb-server')
const cp = require('child_process')
const cloneDeep = require('lodash/cloneDeep')
const bluebird = require('bluebird')

/**
 * @function diehard
 * @description handle setup/teardown errors mercilessly.  kill the process
 * and abandon tests
 */
const diehard = (err) => {
  console.error(err.message)
  console.error(err.stack)
  process.exit(1)
}

module.exports = {

  dbURL: function (dbname) {
    if (!dbname) { throw new ReferenceError('dbname required') }
    return url.format({
      protocol: 'http',
      hostname: 'localhost',
      port: config.port,
      pathname: dbname
    })
  },

  /**
   * @function setup
   * @description boots a pouchdb-server, a dbRegistry instance, and
   * a computation registry instance.  these utilities are commonly
   * required for PipelineRunnerPool testing
   */
  setup: function () {
    return new Promise((resolve, reject) => {
      try {
        cp.execSync(`lsof -i :${config.port} | awk 'NR!=1 {print $2}' | xargs kill`)
      } catch (err) {
        // return rej(err) // permit failure
      }

      // spawn-pouchdb-server mutates user input >:(
      // https://github.com/hoodiehq/spawn-pouchdb-server/pull/33
      pdbs(cloneDeep(config), (err, srv) => {
        if (err) { diehard(err) }
        this.server = srv
        return resolve(srv)
      })
    })
  },

  teardown: function () {
    return bluebird.delay(200)
    .then(() => {
      return new Promise((resolve, reject) => {
        return this.server.stop((err) => {
          if (err) { diehard(err.message) }
          return resolve()
        })
      })
    })
  }
}
