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

/**
 * @function diehard
 * @description handle setup/teardown errors mercilessly.  kill the process
 * and abandon tests
 */
const diehard = (err: any) => {
  console.error(err.message)
  console.error(err.stack)
  process.exit(1)
}

export function dbURL (dbname: string) {
  if (!dbname) {
    throw new ReferenceError('dbname required')
  }
  return url.format({
    protocol: 'http',
    hostname: 'localhost',
    port: config.port,
    pathname: dbname
  })
}

let hackStatefulServer: any

/**
 * @function setup
 * @description boots a pouchdb-server, a dbRegistry instance, and
 * a computation registry instance.  these utilities are commonly
 * required for PipelineRunnerPool testing
 */
export function setup () {
  return new Promise((resolve, reject) => {
    try {
      cp.execSync(
        `lsof -i :${config.port} | awk 'NR!=1 {print $2}' | xargs kill`
      )
    } catch (err) {
      // return rej(err) // permit failure
    }

    // spawn-pouchdb-server mutates user input >:(
    // https://github.com/hoodiehq/spawn-pouchdb-server/pull/33
    pdbs(cloneDeep(config), (err: any, srv: any) => {
      if (err) diehard(err)
      hackStatefulServer = srv
      return resolve(srv)
    })
  })
}

export function teardown () {
  return new Promise((resolve, reject) => {
    return hackStatefulServer.stop((err: any) => {
      if (err) {
        diehard(err.message)
      }
      return resolve()
    })
  })
}
