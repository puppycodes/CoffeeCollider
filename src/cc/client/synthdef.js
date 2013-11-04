define(function(require, exports, module) {
  "use strict";

  var cc = require("./cc");
  var fn = require("./fn");
  var utils  = require("./utils");
  var extend = require("../common/extend");
  
  var defId = 0;
  
  var SynthDef = (function() {
    function SynthDef(func, _args) {
      this.klassName = "SynthDef";
      this._defId = defId++;
      if (!(func && _args)) {
        this.specs = {
          consts:[], defs:[], params:{ names:[], indices:[], length:[], values:[] }
        };
        return;
      }
      
      var children = [];
      cc.setSynthDef(function(ugen) {
        children.push(ugen);
      });
      
      var args     = args2keyValues(_args);
      var params   = args2params(args);
      var controls = cc.createControl(C.CONTROL).init(params.flatten);
      if (!Array.isArray(controls)) {
        controls = [ controls ];
      }
      
      try {
        func.apply(null, reshapeArgs(args.vals, controls).concat(params.opts));
      } catch (e) {
        throw e.toString();
      } finally {
        cc.setSynthDef(null);
      }
      var consts  = getConstValues(children);
      var defList = makeDefList(topoSort(children), consts);
      
      var specs = {
        consts : consts,
        defList: defList,
        params : params.params
      };
      this.specs = specs;
      // console.log(specs);
      
      cc.client.pushToTimeline([
        "/s_def", this._defId, JSON.stringify(specs)
      ]);
    }
    extend(SynthDef, cc.Object);
    
    SynthDef.prototype.play = fn(function() {
      var target, args, addAction;
      var i = 0;
      if (cc.instanceOfNode(arguments[i])) {
        target = arguments[i++];
      } else {
        target = cc.client.rootNode;
      }
      if (utils.isDict(arguments[i])) {
        args = arguments[i++];
      }
      if (typeof arguments[i] === "string") {
        addAction = arguments[i];
      } else {
        addAction = "addToHead";
      }
      if (args && arguments.length === 1) {
        if (cc.instanceOdNode(args.target)) {
          target = args.target;
          delete args.target;
        }
        if (typeof args.addAction === "string") {
          addAction = args.addAction;
          delete args.addAction;
        }
      }
      switch (addAction) {
      case "addToHead":
        return cc.createSynth(target, C.ADD_TO_HEAD, this, args);
      case "addToTail":
        return cc.createSynth(target, C.ADD_TO_TAIL, this, args);
      case "addBefore":
        return cc.createSynth(target, C.ADD_BEFORE, this, args);
      case "addAfter":
        return cc.createSynth(target, C.ADD_AFTER, this, args);
      default:
        return cc.createSynth(target, C.ADD_TO_HEAD, this, args);
      }
    }).multiCall().build();
    
    return SynthDef;
  })();
  
  // private methods
  var args2keyValues = function(args) {
    var keys = [], vals = [];
    if (args && args.length) {
      for (var i = 0, imax = args.length; i < imax; i += 2) {
        keys.push(args[i+0]);
        vals.push(args[i+1]);
      }
    }
    return { keys:keys, vals:vals };
  };

  var args2params = function(args) {
    var params  = { names:[], indices:[], length:[], values:[] };
    var flatten = [];
    var opts    = null;
    for (var i = 0, imax = args.vals.length; i < imax; ++i) {
      var value;
      try {
        value = JSON.parse(args.vals[i]);
      } catch (e) {
        throw new TypeError("SynthDefFunction's arguments should be a JSONable: " + args.vals[i]);
      }
      if (isValidDefArg(value)) {
        var length = Array.isArray(value) ? value.length : 1;
        params.names  .push(args.keys[i]);
        params.indices.push(flatten.length);
        params.length .push(length);
        params.values .push(value);
        flatten = flatten.concat(value);
      } else if (i === imax - 1 && utils.isDict(value)) {
        // allow a dictionary be put the last
        opts = value;
      } else {
        throw new TypeError("SynthDefFunction's arguments should be a constant number or an array that contains it.");
      }
      if (opts) {
        args.keys.pop();
        args.vals.pop();
      }
    }
    return { params:params, flatten:flatten, opts:opts };
  };

  var isValidDefArg = function(obj) {
    if (typeof obj === "number") {
      return true;
    }
    if (Array.isArray(obj)) {
      return obj.every(function(obj) {
        return typeof obj === "number";
      });
    }
    return false;
  };
  
  var reshapeArgs = function(shape, flatten) {
    var result = [];
    var saved = flatten.slice();
    for (var i = 0, imax = shape.length; i < imax; ++i) {
      if (Array.isArray(shape[i])) {
        result.push(saved.splice(0, shape[i].length));
      } else {
        result.push(saved.shift());
      }
    }
    return result;
  };

  var getConstValues = function(list) {
    var consts = [];
    list.forEach(function(x) {
      if (x.inputs) {
        x.inputs.forEach(function(_in) {
          if (typeof _in === "number" && consts.indexOf(_in) === -1) {
            consts.push(_in);
          }
        });
      }
    });
    return consts.sort();
  };
  
  var topoSort = (function() {
    var _topoSort = function(x, list, checked, stack) {
      if (stack.indexOf(x) !== stack.length-1) {
        console.warn("UGen graph contains recursion.");
        return;
      }
      checked.push(x);
      var index = list.indexOf(x);
      if (index !== -1) {
        list.splice(index, 1);
      }
      list.unshift(x);
      if (x.inputs) {
        x.inputs.forEach(function(x) {
          stack.push(x);
          _topoSort(x, list, checked, stack);
          stack.pop();
        });
      }
    };
    return function(list) {
      var checked = [];
      var stack;
      list.slice().forEach(function(x) {
        if (cc.instanceOfOut(x)) {
          checked.push(x);
          stack = [x];
          x.inputs.forEach(function(x) {
            stack.push(x);
            _topoSort(x, list, checked, stack);
            stack.pop();
          });
        }
      });
      list = list.filter(function(x) {
        return checked.indexOf(x) !== -1;
      });
      return list;
    };
  })();
  
  var getRate = function(ugen) {
    return ugen.rate;
  };
  var discard = function(ugen) {
    return typeof ugen !== "number" && !cc.instanceOfOutputProxy(ugen);
  };
  var makeDefList = function(list, consts) {
    var result = [];
    list = list.filter(discard);
    for (var i = 0, imax = list.length; i < imax; ++i) {
      var ugen = list[i];
      var inputs = [], outputs;
      for (var j = 0, jmax = ugen.inputs.length; j < jmax; ++j) {
        var index, subindex;
        if (cc.instanceOfOutputProxy(ugen.inputs[j])) {
          index = list.indexOf(ugen.inputs[j].inputs[0]);
        } else {
          index = list.indexOf(ugen.inputs[j]);
        }
        if (index !== -1) {
          subindex = ugen.inputs[j].outputIndex|0;
        } else {
          subindex = consts.indexOf(ugen.inputs[j]);
        }
        inputs.push(index, subindex);
      }
      if (cc.instanceOfMultiOutUGen(ugen)) {
        outputs = ugen.channels.map(getRate);
      } else if (ugen.numOfOutputs === 1) {
        outputs = [ ugen.rate ];
      } else {
        outputs = [];
      }
      result.push(
        [ ugen.klassName, ugen.rate, ugen.specialIndex|0, inputs, outputs, ugen.tag||"" ]
      );
    }
    return result;
  };
  
  module.exports = {
    SynthDef: SynthDef,

    args2keyValues: args2keyValues,
    args2params   : args2params,
    isValidDefArg : isValidDefArg,
    reshapeArgs   : reshapeArgs,
    getConstValues: getConstValues,
    topoSort      : topoSort,
    makeDefList   : makeDefList,
    
    use: function() {
      cc.createSynthDef = function(func, args) {
        return new SynthDef(func, args);
      };
      cc.instanceOfSynthDef = function(obj) {
        return obj instanceof SynthDef;
      };
    }
  };

});
