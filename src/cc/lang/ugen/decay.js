define(function(require, exports, module) {
  "use strict";

  var cc = require("../cc");
  
  cc.ugen.specs.Integrator = {
    checkInputs: cc.ugen.checkSameRateAsFirstInput,
    $ar: {
      defaults: "in=0,coef=1,mul=1,add=0",
      ctor: function(_in, coef, mul, add) {
        return cc.ugen.multiNewList(this, [C.AUDIO, _in, coef]).madd(mul, add);
      }
    },
    $kr: {
      defaults: "in=0,coef=1,mul=1,add=0",
      ctor: function(_in, coef, mul, add) {
        return cc.ugen.multiNewList(this, [C.CONTROL, _in, coef]).madd(mul, add);
      }
    }
  };

  cc.ugen.specs.Decay = {
    checkInputs: cc.ugen.checkSameRateAsFirstInput,
    $ar: {
      defaults: "in=0,decayTime=1,mul=1,add=0",
      ctor: function(_in, decayTime, mul, add) {
        return cc.ugen.multiNewList(this, [C.AUDIO, _in, decayTime]).madd(mul, add);
      }
    },
    $kr: {
      defaults: "in=0,decayTime=1,mul=1,add=0",
      ctor: function(_in, decayTime, mul, add) {
        return cc.ugen.multiNewList(this, [C.CONTROL, _in, decayTime]).madd(mul, add);
      }
    }
  };
  
  cc.ugen.specs.Decay2 = {
    checkInputs: cc.ugen.checkSameRateAsFirstInput,
    $ar: {
      defaults: "in=0,attackTime=0.01,decayTime=1,mul=1,add=0",
      ctor: function(_in, attackTime, decayTime, mul, add) {
        return cc.ugen.multiNewList(this, [C.AUDIO, _in, attackTime, decayTime]).madd(mul, add);
      }
    },
    $kr: {
      defaults: "in=0,attackTime=0.01,decayTime=1,mul=1,add=0",
      ctor: function(_in, attackTime, decayTime, mul, add) {
        return cc.ugen.multiNewList(this, [C.CONTROL, _in, attackTime, decayTime]).madd(mul, add);
      }
    }
  };
  
  module.exports = {};

});
