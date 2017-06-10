if (!Function.prototype.bind) {
  Function.prototype.bind = function (oThis) { // eslint-disable-line
    if (typeof this !== 'function') {
      // closest thing possible to the ECMAScript 5
      // internal IsCallable function
      throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable')
    }

    var aArgs = Array.prototype.slice.call(arguments, 1)
    var fToBind = this
    var FNOP = function () {}
    var fBound = function () {
      return fToBind.apply(this instanceof FNOP
        ? this
        : oThis,
        aArgs.concat(Array.prototype.slice.call(arguments)))
    }

    if (this.prototype) {
      // Function.prototype doesn't have a prototype property
      FNOP.prototype = this.prototype
    }
    fBound.prototype = new FNOP()

    return fBound
  }
}
