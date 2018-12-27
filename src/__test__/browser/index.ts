import '@babel/polyfill'
import common from '../common/'
global.Promise = require('bluebird')
common({})
