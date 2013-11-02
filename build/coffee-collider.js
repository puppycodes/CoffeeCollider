(function(global) {
"use strict";
var _define = function(module, /*deps,*/ payload) {
  if (!_define.modules) {
    _define.modules  = {};
    _define.payloads = {};
  }
  _define.payloads[module] = payload;
  _define.modules[module]  = null;
};
var _require = function(parentId, moduleName) {
  moduleName = normalizeModule(parentId, moduleName);
  var module = _define.modules[moduleName];
  if (!module) {
    module = _define.payloads[moduleName];
    var exports = {};
    var mod = { id:moduleName, exports:exports };
    var req = function(module) {
      return _require(moduleName, module);
    };
    var ret = module(req, exports, mod);
    exports = ret || mod.exports;
    _define.modules[moduleName] = exports;
    delete _define.payloads[moduleName];
  }
  module = _define.modules[moduleName] = exports || module;
  return module;
};
var normalizeModule = function(parentId, moduleName) {
  if (moduleName.charAt(0) === ".") {
    var base = parentId.split("/").slice(0, -1).join("/");
    moduleName = base + "/" + moduleName;
    var previous;
    while (moduleName.indexOf(".") !== -1 && previous !== moduleName) {
      previous   = moduleName;
      moduleName = moduleName.replace(/\/\.\//, "/").replace(/[^\/]+\/\.\.\//, "");
    }
  }
  return moduleName;
};
if (typeof require === "function") {
  global.require = require;
}
var define = _define;
define('cc/loader', function(require, exports, module) {

  var cc = require("./cc");

  if (typeof document !== "undefined") {
    var scripts = document.getElementsByTagName("script");
    if (scripts && scripts.length) {
      for (var i = 0; i < scripts.length; i++) {
        var m = /^(.*\/)coffee-collider(?:-min)?\.js(\#.*)?$/.exec(scripts[i].src);
        if (m) {
          cc.rootPath = m[1];
          cc.coffeeColliderPath = m[0];
          cc.coffeeColliderHash = m[2];
          break;
        }
      }
    }
    if (cc.coffeeColliderHash === "#iframe") {
      cc.opmode  = "iframe";
      cc.context = "client";
      require("./client/client").use();
      cc.client = cc.createSynthClient();
    } else if (cc.coffeeColliderHash === "#socket") {
      cc.opmode  = "socket";
      cc.context = "client";
      require("./client/client").use();
      cc.client = cc.createSynthClient();
    } else {
      cc.opmode  = "exports";
      cc.context = "exports";
      require("./exports/coffeecollider").use();
      global.CoffeeCollider = function(opts) {
        return cc.createCoffeeCollider(opts);
      };
    }
  } else if (typeof WorkerLocation !== "undefined") {
    if (location.hash === "#iframe") {
      cc.opmode  = "iframe";
      cc.context = "server";
      require("./server/server").use();
      cc.server = cc.createSynthServer();
      cc.server.connect();
    } else {
      cc.opmode  = "worker";
      cc.context = "client/server";
      require("./client/client").use();
      require("./server/server").use();
      cc.client = cc.createSynthClient();
      cc.server = cc.createSynthServer();
      cc.client.sendToServer = cc.server.recvFromClient.bind(cc.server);
      cc.server.sendToClient = cc.client.recvFromServer.bind(cc.client);
      cc.server.connect();
    }
  } else if (typeof global.GLOBAL !== "undefined") {
    cc.global.CoffeeCollider = function() {
      cc.opmode  = "nodejs";
      cc.context = "exports/client/server";
      require("./exports/coffeecollider").use();
      require("./client/client").use();
      require("./server/server").use();
      cc.exports = cc.createCoffeeCollider({nodejs:true});
      cc.client  = cc.createSynthClient();
      cc.server  = cc.createSynthServer();
      cc.exports.impl.sendToClient = cc.client.recvFromIF.bind(cc.client);
      cc.client.sendToServer  = cc.server.recvFromClient.bind(cc.server);
      cc.server.sendToClient  = cc.client.recvFromServer.bind(cc.client);
      cc.client.sendToIF      = cc.exports.impl.recvFromClient.bind(cc.exports.impl);
      cc.server.connect();
      return cc.exports;
    };
    cc.global.SocketSynthServer = function(opts) {
      cc.opmode  = "socket";
      cc.context = "server";
      require("./server/server").use();
      cc.server = cc.createSynthServer();
      return cc.server.exports.createServer(opts);
    };
    module.exports = cc.global;
  }

});
define('cc/cc', function(require, exports, module) {

  function CCObject() {
  }
  
  module.exports = {
    version: "0.0.0",
    global: {},
    Object: CCObject
  };

});
define('cc/client/client', function(require, exports, module) {
  
  var cc = require("./cc");
  var extend = require("../common/extend");
  var pack   = require("../common/pack").pack;
  var commands = {};
  
  var SynthClient = (function() {
    function SynthClient() {
      this.klassName = "SynthClient";
      this.sampleRate = 0;
      this.channels   = 0;
      this.strmLength = 0;
      this.bufLength  = 0;
      this.rootNode   = cc.createGroup();
      this.timeline   = cc.createTimeline();
      this.timelineResult  = [];
      this.bufferRequestId = 0;
      this.bufferRequestCallback = {};
      this.phase = 0;
    }
    
    SynthClient.prototype.sendToIF = function() {
      throw "SynthClient#sendToIF: should be overridden";
    };
    SynthClient.prototype.recvFromIF = function(msg) {
      if (msg) {
        var func = commands[msg[0]];
        if (func) {
          func.call(this, msg);
        }
      }
    };
    SynthClient.prototype.sendToServer = function() {
      throw "SynthClient#sendToServer: should be overridden";
    };
    SynthClient.prototype.recvFromServer = function(msg) {
      if (msg instanceof Int16Array) {
        this.sendToIF(msg);
      } else {
        var func = commands[msg[0]];
        if (func) {
          func.call(this, msg);
        } else {
          throw new Error("Unknown command: " + msg[0]);
        }
      }
    };
    SynthClient.prototype.pushToTimeline = function(cmd) {
      this.timelineResult.push(cmd);
    };
    SynthClient.prototype.play = function(msg) {
      this.timeline.play((this.bufLength / this.sampleRate) * 1000);
      this.sendToServer(msg);
    };
    SynthClient.prototype.pause = function(msg) {
      this.sendToServer(msg);
    };
    SynthClient.prototype.reset = function(msg) {
      cc.resetBuffer();
      cc.resetNode();
      cc.resetNativeTimers();
      this.timeline.reset();
      this.sendToServer(msg);
    };
    SynthClient.prototype.requestBuffer = function(path, callback) {
      if (!(typeof path === "string" && typeof callback === "function")) {
        return;
      }
      var requestId = this.bufferRequestId++;
      this.bufferRequestCallback[requestId] = callback;
      this.sendToIF(["/buffer/request", path, requestId]);
    };
    SynthClient.prototype.process = function() {
      throw "SynthClient#process: should be overridden";
    };
    
    return SynthClient;
  })();
  
  
  var WorkerSynthClient = (function() {
    function WorkerSynthClient() {
      SynthClient.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 1024;
      this.bufLength  = 64;
    }
    extend(WorkerSynthClient, SynthClient);
    
    WorkerSynthClient.prototype.sendToIF = function(msg) {
      postMessage(msg);
    };
    WorkerSynthClient.prototype.process = function() {
      this.timeline.process();
      var timelineResult = this.timelineResult.splice(0);
      this.sendToServer(["/processed", timelineResult]);
    };
    
    return WorkerSynthClient;
  })();
  
  
  var IFrameSynthClient = (function() {
    require("../common/browser").use();
    function IFrameSynthClient() {
      SynthClient.call(this);
      var that = this;
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 2048;
      this.bufLength  = 128;
      this.server = cc.createWebWorker(cc.coffeeColliderPath);
      this.server.onmessage = function(e) {
        that.recvFromServer(e.data);
      };
      require("../common/console").bindConsoleApply(commands);
    }
    extend(IFrameSynthClient, SynthClient);
    
    IFrameSynthClient.prototype.sendToServer = function(msg) {
      this.server.postMessage(msg);
    };
    IFrameSynthClient.prototype.process = function() {
      var timeline = this.timeline;
      var n = this.strmLength / this.bufLength;
      var timelineResult = [];
      while (n--) {
        timeline.process();
        timelineResult = timelineResult.concat(
          this.timelineResult.splice(0), 0
        );
      }
      this.sendToServer(["/processed", timelineResult]);
    };
    
    return IFrameSynthClient;
  })();
  
  
  var NodeJSSynthClient = (function() {
    function NodeJSSynthClient() {
      SynthClient.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 4096;
      this.bufLength  = 64;
    }
    extend(NodeJSSynthClient, SynthClient);

    NodeJSSynthClient.prototype.process = function() {
      this.timeline.process();
      var timelineResult = this.timelineResult.splice(0);
      this.sendToServer(["/processed", timelineResult]);
    };
    
    return NodeJSSynthClient;
  })();
  
  
  var SocketSynthClient = (function() {
    require("../common/browser").use();
    function SocketSynthClient() {
      NodeJSSynthClient.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 4096;
      this.bufLength  = 128;
      this.socketPath = null;
    }
    extend(SocketSynthClient, NodeJSSynthClient);

    SocketSynthClient.prototype.openSocket = function() {
      var that = this;
      var socket   = this.socket = cc.createWebSocket(this.socketPath);
      var pendings = [];
      socket.binaryType = "arraybuffer";
      socket.onopen = function() {
        pendings.forEach(function(msg) {
          socket.send(msg);
        });
        pendings = [];
      };
      socket.onmessage = function(e) {
        // receive a message from the socket-server
        var msg = e.data;
        if (typeof msg !== "string") {
          that.sendToIF(new Int16Array(msg));
          return;
        }
        that.recvFromServer(JSON.parse(msg));
      };
      socket.onclose = function() {
      };
      socket.onerror = function() {
      };
      this.sendToServer = function(msg) {
        if (msg instanceof Uint8Array) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(msg.buffer);
          }
        } else {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(msg));
          } else {
            pendings.push(JSON.stringify(msg));
          }
        }
      };
    };
    SocketSynthClient.prototype.closeSocket = function() {
      this.socket.close();
      this.socket = null;
    };
    
    SocketSynthClient.prototype.process = function() {
      var timeline = this.timeline;
      var n = this.strmLength / this.bufLength;
      var timelineResult = [];
      while (n--) {
        timeline.process();
        timelineResult = timelineResult.concat(
          this.timelineResult.splice(0), 0
        );
      }
      this.sendToServer(["/processed", timelineResult]);
    };
    
    return SocketSynthClient;
  })();
  
  
  commands["/connected"] = function(msg) {
    if (cc.opmode !== "nodejs") {
      msg.push(Object.keys(cc.global));
    }
    this.sendToIF(msg);
  };
  commands["/init"] = function(msg) {
    this.sampleRate = msg[1]|0;
    this.channels   = msg[2]|0;
    this.sendToServer(msg);
  };
  commands["/play"] = function(msg) {
    this.play(msg);
  };
  commands["/pause"] = function(msg) {
    this.pause(msg);
  };
  commands["/reset"] = function(msg) {
    this.reset(msg);
  };
  commands["/process"] = function() {
    this.process();
  };
  commands["/socket/open"] = function() {
    this.openSocket();
  };
  commands["/socket/close"] = function() {
    this.closeSocket();
  };
  commands["/socket/sendToServer"] = function(msg) {
    // receive a message from the client-interface
    this.sendToServer(msg);
  };
  commands["/socket/sendToIF"] = function(msg) {
    // receive a message from the client-interface
    this.sendToIF(msg);
  };
  commands["/execute"] = function(msg) {
    var execId   = msg[1];
    var code     = msg[2];
    var append   = msg[3];
    var data     = msg[4];
    var callback = msg[5];
    if (!append) {
      this.reset(["/reset"]);
    }
    cc.DATA = data;
    global._gltc_ = this.timeline.context;
    if (cc.global !== global) {
      global.cc = cc.global;
    }
    var result = eval.call(global, code);
    if (callback) {
      this.sendToIF(["/executed", execId, pack(result)]);
    }
  };
  commands["/buffer/response"] = function(msg) {
    var buffer = msg[1];
    var requestId = msg[2];
    var callback = this.bufferRequestCallback[requestId];
    if (callback) {
      callback(buffer);
      delete this.bufferRequestCallback[requestId];
    }
  };
  commands["/importScripts"] = function(msg) {
    importScripts(msg[1]);
  };
  commands["/console/log"] = function(msg) {
    this.sendToIF(msg);
  };
  commands["/console/debug"] = function(msg) {
    this.sendToIF(msg);
  };
  commands["/console/info"] = function(msg) {
    this.sendToIF(msg);
  };
  commands["/console/warn"] = function(msg) {
    this.sendToIF(msg);
  };
  commands["/console/error"] = function(msg) {
    this.sendToIF(msg);
  };
  commands["/emit/n_end"] = function(msg) {
    var nodeId = msg[1]|0;
    var n = cc.getNode(nodeId);
    if (n) {
      n.emit("end");
    }
  };
  commands["/emit/n_done"] = function(msg) {
    var nodeId = msg[1]|0;
    var tag    = msg[2];
    var n = cc.getNode(nodeId);
    if (n) {
      n.emit("done", tag);
    }
  };
  
  
  module.exports = {
    use: function() {
      require("../common/timer").use();
      require("./buffer").use();
      require("./node").use();
      require("./sched").use();
      require("./random").use();
      require("./ugen/installer").use();
      
      cc.createSynthClient = function() {
        require("./object");
        require("./number");
        require("./ugen/ugen").install();
        switch (cc.opmode) {
        case "worker":
          return cc.createWorkerSynthClient();
        case "iframe":
          return cc.createIFrameSynthClient();
        case "nodejs":
          return cc.createNodeJSSynthClient();
        case "socket":
          return cc.createSocketSynthClient();
        }
        throw new Error("A SynthClient is not defined for: " + cc.opmode);
      };
      var onmessage = function(e) {
        var msg = e.data;
        if (msg instanceof Uint8Array) {
          cc.client.sendToServer(msg);
        } else {
          cc.client.recvFromIF(msg);
        }
      };
      cc.createWorkerSynthClient = function() {
        var client = new WorkerSynthClient();
        global.onmessage = onmessage;
        cc.opmode = "worker";
        return client;
      };
      cc.createIFrameSynthClient = function() {
        var client = new IFrameSynthClient();
        if (typeof window !== "undefined") {
          window.onmessage = function(e) {
            e.ports[0].onmessage = onmessage;
            client.sendToIF = function(msg) {
              e.ports[0].postMessage(msg);
            };
            window.onmessage = null;
          };
        }
        cc.opmode = "iframe";
        return client;
      };
      cc.createNodeJSSynthClient = function() {
        var client = new NodeJSSynthClient();
        cc.opmode = "nodejs";
        return client;
      };
      cc.createSocketSynthClient = function() {
        var client = new SocketSynthClient();
        if (typeof window !== "undefined") {
          window.onmessage = function(e) {
            e.ports[0].onmessage = onmessage;
            client.sendToIF = function(msg) {
              e.ports[0].postMessage(msg);
            };
            client.socketPath = e.data;
            window.onmessage = null;
          };
        }
        cc.opmode = "socket";
        return client;
      };
      cc.replaceNativeTimerFunctions();
    }
  };

});
define('cc/client/cc', function(require, exports, module) {
  
  module.exports = require("../cc");

});
define('cc/common/extend', function(require, exports, module) {
  
  var extend = function(child, parent) {
    for (var key in parent) {
      if (parent.hasOwnProperty(key)) {
        child[key] = parent[key];
      }
    }
    /*jshint validthis:true */
    function ctor() {
      this.constructor = child;
    }
    /*jshint validthis:false */
    ctor.prototype = parent.prototype;
    /*jshint newcap:false */
    child.prototype = new ctor();
    /*jshint newcap:true */
    child.__super__ = parent.prototype;
    return child;
  };
  
  module.exports = extend;

});
define('cc/common/pack', function(require, exports, module) {
  
  var pack = (function() {
    var _pack = function(data, stack) {
      if (!data) {
        return data;
      }
      if (stack.indexOf(data) !== -1) {
        return { klassName:"Circular" };
      }
      if (typeof data === "function") {
        return "[Function]";
      }
      var result;
      if (typeof data === "object") {
        if (data.buffer instanceof ArrayBuffer) {
          return data;
        }
        stack.push(data);
        if (Array.isArray(data)) {
          result = data.map(function(data) {
            return _pack(data, stack);
          });
        } else {
          result = {};
          Object.keys(data).forEach(function(key) {
            if (key.charAt(0) !== "_") {
              result[key] = _pack(data[key], stack);
            }
          });
        }
        stack.pop();
      } else {
        result = data;
      }
      return result;
    };
    return function(data) {
      return _pack(data, []);
    };
  })();

  var unpack = (function() {
    var func = function() {};
    var _unpack = function(data) {
      if (!data) {
        return data;
      }
      if (typeof data === "string") {
        if (data === "[Function]") {
          return func;
        }
        return data;
      }
      var result;
      if (typeof data === "object") {
        if (data.buffer instanceof ArrayBuffer) {
          return data;
        }
        if (Array.isArray(data)) {
          result = data.map(function(data) {
            return _unpack(data);
          });
        } else {
          if (data.klassName && /^[_a-z$][_a-z0-9$]*$/i.test(data.klassName)) {
            result = eval.call(null, "new (function " + data.klassName + "(){})");
            delete data.klassName;
          } else {
            result = {};
          }
          Object.keys(data).forEach(function(key) {
            result[key] = _unpack(data[key]);
          });
        }
      } else {
        result = data;
      }
      return result;
    };
    return function(data) {
      return _unpack(data);
    };
  })();
  
  module.exports = {
    pack  : pack,
    unpack: unpack
  };

});
define('cc/common/browser', function(require, exports, module) {

  var cc = require("../cc");
  
  module.exports = {
    use: function() {
      cc.createWebWorker = function(path) {
        return new Worker(path);
      };
      cc.createWebSocket = function(path) {
        return new WebSocket(path);
      };
      cc.createXMLHttpRequest = function() {
        return new XMLHttpRequest();
      };
      cc.createMessageChannel = function() {
        return new MessageChannel();
      };
      cc.createHTMLIFrameElement = function() {
        var iframe = document.createElement("iframe");
        iframe.style.width  = 0;
        iframe.style.height = 0;
        iframe.style.border = 0;
        document.body.appendChild(iframe);
        return iframe;
      };
    }
  };

});
define('cc/common/console', function(require, exports, module) {
  
  var unpack = require("./pack").unpack;
  
  var bindConsoleApply = function(commands) {
    commands["/console/log"] = function(msg) {
      console.log.apply(console, unpack(msg[1]));
    };
    commands["/console/debug"] = function(msg) {
      console.debug.apply(console, unpack(msg[1]));
    };
    commands["/console/info"] = function(msg) {
      console.info.apply(console, unpack(msg[1]));
    };
    commands["/console/warn"] = function(msg) {
      console.warn.apply(console, unpack(msg[1]));
    };
    commands["/console/error"] = function(msg) {
      console.error.apply(console, unpack(msg[1]));
    };
  };
  
  module.exports = {
    bindConsoleApply: bindConsoleApply
  };

});
define('cc/common/timer', function(require, exports, module) {

  var cc = require("../cc");
  
  // save native timer functions
  var _setInterval   = setInterval;
  var _clearInterval = clearInterval;
  var _setTimeout    = setTimeout;
  var _clearTimeout  = clearTimeout;
  
  var NativeTimer = (function() {
    function NativeTimer() {
      this._timerId = 0;
    }
    NativeTimer.prototype.start = function(callback, interval) {
      if (this._timerId) {
        _clearInterval(this._timerId);
      }
      this._timerId = 0;
      if (typeof callback === "function" && typeof interval === "number") {
        this._timerId = _setInterval(callback, interval);
      }
    };
    NativeTimer.prototype.stop = function() {
      if (this._timerId) {
        _clearInterval(this._timerId);
      }
      this._timerId = 0;
    };
    NativeTimer.prototype.isRunning = function() {
      return !!this._timerId;
    };
    return NativeTimer;
  })();

  var WorkerTimer = (function() {
    if (typeof Worker === "undefined") {
      return;
    }
    /*global URL:true */
    var worker_path = (function() {
      try {
        var source = "var t=0;onmessage=function(e){if(t)t=clearInterval(t),0;if(typeof e.data=='number'&&e.data>0)t=setInterval(function(){postMessage(0);},e.data);};";
        var blob = new Blob([source], {type:"text/javascript"});
        var path = URL.createObjectURL(blob);
        new Worker(path);
        return path;
      } catch (e) {}
    })();
    /*global URL:false */
    if (!worker_path) {
      return;
    }
    function WorkerTimer() {
      this._worker = new Worker(worker_path);
      this._worker.onmessage = null;
    }
    WorkerTimer.prototype.start = function(callback, interval) {
      if (this._worker.onmessage) {
        this._worker.postMessage(0);
      }
      this._worker.onmessage = null;
      if (typeof callback === "function" && typeof interval === "number") {
        this._worker.onmessage = callback;
        this._worker.postMessage(interval);
      }
    };
    WorkerTimer.prototype.stop = function() {
      if (this._worker.onmessage) {
        this._worker.postMessage(0);
      }
      this._worker.onmessage = null;
    };
    NativeTimer.prototype.isRunning = function() {
      return !!this._worker.onmessage;
    };
    return WorkerTimer;
  })();

  var timerIdCache = [];
  var replaceNativeTimerFunctions = function() {
    global.setInterval = function(func, delay) {
      var id = _setInterval(func, delay);
      timerIdCache.push(id);
      return id;
    };
    global.clearInterval = function(id) {
      _clearInterval(id);
      var index = timerIdCache.indexOf(id);
      if (index !== -1) {
        timerIdCache.splice(index, 1);
      }
    };
    global.setTimeout = function(func, delay) {
      var id = _setTimeout(func, delay);
      timerIdCache.push(id);
      return id;
    };
    global.clearTimeout = function(id) {
      _clearTimeout(id);
      var index = timerIdCache.indexOf(id);
      if (index !== -1) {
        timerIdCache.splice(index, 1);
      }
    };
  };
  var restoreNativeTimerFunctions = function() {
    global.setInterval   = _setInterval;
    global.clearInterval = _clearInterval;
    global.setTimeout    = _setTimeout;
    global.clearTimeout  = _clearTimeout;
  };
  var resetNativeTimers = function() {
    timerIdCache.splice(0).forEach(function(timerId) {
      _clearInterval(timerId);
      _clearTimeout(timerId);
    });
  };
  
  module.exports = {
    WorkerTimer: WorkerTimer,
    NativeTimer: NativeTimer,
    
    use: function() {
      cc.createTimer = function() {
        if (WorkerTimer) {
          return new WorkerTimer();
        }
        return new NativeTimer();
      };
      cc.replaceNativeTimerFunctions = replaceNativeTimerFunctions;
      cc.restoreNativeTimerFunctions = restoreNativeTimerFunctions;
      cc.resetNativeTimers = resetNativeTimers;
    }
  };

});
define('cc/client/buffer', function(require, exports, module) {

  var cc = require("./cc");
  var fn = require("./fn");
  var extend = require("../common/extend");
  var emitter = require("../common/emitter");

  var bufSrcId = 0;
  var bufferSrcCache = {};

  var AudioBuffer = (function() {
    var bufId = 0;
    function AudioBuffer() {
      emitter.mixin(this);
      this.klassName = "Buffer";
      // TODO: set below parameters
      this.frames     = 0;
      this.channels   = 0;
      this.sampleRate = 0;
      
      this._blocking = true;
      this._bufId = bufId++;
      cc.client.pushToTimeline([
        "/b_new", this._bufId
      ]);
    }
    extend(AudioBuffer, cc.Object);
    
    AudioBuffer.prototype.performWait = function() {
      return this._blocking;
    };
    
    return AudioBuffer;
  })();
  
  var newBufferSource = function(path, buffer) {
    // binary data format
    //  0 command
    //  1
    //  2 bufSrcId
    //  3
    //  4 (not use)
    //  5
    //  6 channels
    //  7
    //  8 sampleRate
    //  9
    // 10
    // 11
    // 12 numFrames
    // 13
    // 14
    // 15
    // 16.. samples
    var uint8 = new Uint8Array(16 + buffer.samples.length * 4);
    var int16 = new Uint16Array(uint8.buffer);
    var int32 = new Uint32Array(uint8.buffer);
    var f32   = new Float32Array(uint8.buffer);
    var _bufSrcId = bufSrcId++;
    int16[0] = 1;
    int16[1] = _bufSrcId;
    int16[3] = buffer.numChannels;
    int32[2] = buffer.sampleRate;
    int32[3] = buffer.numFrames;
    f32.set(buffer.samples, 4);
    cc.client.sendToServer(uint8);
    bufferSrcCache[path] = _bufSrcId;
    delete buffer.samples;
    return _bufSrcId;
  };
  
  var bindBufferSource = function(bufSrcId, startFrame, numFrames) {
    cc.client.pushToTimeline([
      "/b_bind", this._bufId, bufSrcId, startFrame, numFrames
    ]);
  };
  
  var BufferInterface = function() {
  };
  BufferInterface.read = fn(function(path, startFrame, numFrames) {
    if (typeof path !== "string") {
      throw new TypeError("Buffer.Read: arguments[0] should be a string.");
    }
    var bufSrcId = bufferSrcCache[path];
    var buffer = new AudioBuffer();
    if (typeof bufSrcId === "number") {
      bindBufferSource.call(buffer, bufSrcId, startFrame, numFrames);
    } else {
      cc.client.requestBuffer(path, function(result) {
        if (result) {
          var bufSrcId = newBufferSource(path, result);
          bindBufferSource.call(buffer, bufSrcId, startFrame, numFrames);
        }
      });
    }
    return buffer;
  }).defaults("path,startFrame=0,numFrames=-1").multiCall().build();
  
  var resetBuffer = function() {
    bufferSrcCache = {};
    bufSrcId = 0;
  };
  
  cc.global.Buffer = BufferInterface;
  
  module.exports = {
    AudioBuffer: AudioBuffer,
    
    use: function() {
      cc.createAudioBuffer = function() {
        return new AudioBuffer();
      };
      cc.instanceOfAudioBuffer = function(obj) {
        return obj instanceof AudioBuffer;
      };
      cc.resetBuffer = resetBuffer;
    }
  };

});
define('cc/client/fn', function(require, exports, module) {

  var cc = require("./cc");
  var utils = require("./utils");
  var slice = [].slice;
  
  var fn = (function() {
    function Fn(func) {
      this.func  = func;
      this.def   = null;
      this.multi = false;
    }
    Fn.prototype.defaults = function(def) {
      this.def = def;
      return this;
    };
    Fn.prototype.multiCall = function(flag) {
      this.multi = flag === undefined ? true : !!flag;
      return this;
    };
    Fn.prototype.build = function() {
      var func = this.func;
      var keys = [];
      var vals = [];
      if (this.def) {
        this.def.split(",").forEach(function(items) {
          items = items.trim().split("=");
          keys.push( items[0].trim());
          vals.push(items.length > 1 ? +items[1].trim() : undefined);
        });
      }
      var ret = func;
      if (this.multi) {
        if (this.def) {
          ret = function() {
            var args = slice.call(arguments);
            args = resolve_args(keys, vals, slice.call(arguments));
            if (containsArray(args)) {
              return utils.flop(args).map(function(items) {
                return func.apply(this, items);
              }, this);
            }
            return func.apply(this, args);
          };
        } else {
          ret = function() {
            var args = slice.call(arguments);
            if (containsArray(args)) {
              return utils.flop(args).map(function(items) {
                return func.apply(this, items);
              }, this);
            }
            return func.apply(this, args);
          };
        }
      } else if (this.def) {
        ret = function() {
          var args = slice.call(arguments);
          args = resolve_args(keys, vals, slice.call(arguments));
          return func.apply(this, args);
        };
      }
      return ret;
    };
    var containsArray = function(list) {
      for (var i = 0, imax = list.length; i < imax; ++i) {
        if (Array.isArray(list[i])) {
          return true;
        }
      }
      return false;
    };
    var resolve_args = function(keys, vals, given) {
      var dict;
      var args = vals.slice();
      if (utils.isDict(given[given.length - 1])) {
        dict = given.pop();
        for (var key in dict) {
          var index = keys.indexOf(key);
          if (index !== -1) {
            args[index] = dict[key];
          }
        }
      }
      for (var i = 0, imax = Math.min(given.length, args.length); i < imax; ++i) {
        args[i] = given[i];
      }
      if (dict && args.length < keys.length - 1) {
        args.push(dict);
      }
      return args;
    };
    return function(func) {
      return new Fn(func);
    };
  })();
  
  fn.sync = function(func) {
    return function() {
      cc.timeline.push(this, func, slice.call(arguments));
      return this;
    };
  };

  fn.definePrototypeProperty = function(Klass, key, func) {
    Object.defineProperty(Klass.prototype, key, {
      configurable: true,
      enumerable  : false,
      writable    : true,
      value       : func
    });
  };
  
  module.exports = fn;

});
define('cc/client/utils', function(require, exports, module) {

  var isDict = function(obj) {
    return !!(obj && obj.constructor === Object);
  };
  
  var flop = function(list) {
    var maxSize = list.reduce(function(len, sublist) {
      return Math.max(len, Array.isArray(sublist) ? sublist.length : 1);
    }, 0);
    var result = new Array(maxSize);
    var length = list.length;
    if (length) {
      for (var i = 0; i < maxSize; ++i) {
        var sublist = result[i] = new Array(length);
        for (var j = 0; j < length; ++j) {
          sublist[j] = Array.isArray(list[j]) ? list[j][i % list[j].length] : list[j];
        }
      }
    }
    return result;
  };

  var flatten = (function() {
    var _flatten = function(list, result) {
      for (var i = 0, imax = list.length; i < imax; ++i) {
        if (Array.isArray(list[i])) {
          result = _flatten(list[i], result);
        } else {
          result.push(list[i]);
        }
      }
      return result;
    };
    return function(list) {
      return _flatten(list, []);
    };
  })();

  var clump = function(list, groupSize) {
    var result  = [];
    var sublist = [];
    for (var i = 0, imax = list.length; i < imax; ++i) {
      sublist.push(list[i]);
      if (sublist.length >= groupSize) {
        result.push(sublist);
        sublist = [];
      }
    }
    if (sublist.length) {
      result.push(sublist);
    }
    return result;
  };
  
  module.exports = {
    isDict : isDict,
    flop   : flop,
    flatten: flatten,
    clump  : clump
  };

});
define('cc/common/emitter', function(require, exports, module) {

  var Emitter = (function() {
    function Emitter(context) {
      this.__context   = context || this;
      this.__callbacks = {};
    }
    Emitter.prototype.getListeners = function(event) {
      return this.__callbacks[event] || (this.__callbacks[event] = []);
    };
    Emitter.prototype.hasListeners = function(event) {
      return this.getListeners(event).length > 0;
    };
    Emitter.prototype.on = function(event, callback) {
      var __callbacks = this.getListeners(event);
      if (__callbacks.indexOf(callback) === -1) {
        __callbacks.push(callback);
      }
      return this;
    };
    Emitter.prototype.once = function(event, callback) {
      var that = this;
      function wrapper() {
        that.off(event, wrapper);
        callback.apply(that.__context, arguments);
      }
      wrapper.callback = callback;
      this.on(event, wrapper);
      return this;
    };
    Emitter.prototype.off = function(event, callback) {
      if (arguments.length === 0) {
        this.__callbacks = {};
        return this;
      }
      var __callbacks = this.getListeners(event);
      if (arguments.length === 1) {
        __callbacks.splice(0);
        return this;
      }
      var index = __callbacks.indexOf(callback);
      if (index === -1) {
        for (var i = 0, imax = __callbacks.length; i < imax; ++i) {
          if (__callbacks[i].callback === callback) {
            index = i;
            break;
          }
        }
      }
      if (index !== -1) {
        __callbacks.splice(index, 1);
      }
      return this;
    };
    Emitter.prototype.emit = function(event) {
      var args = Array.prototype.slice.call(arguments, 1);
      var __callbacks = this.getListeners(event).slice(0);
      for (var i = 0, imax = __callbacks.length; i < imax; ++i) {
        __callbacks[i].apply(this.__context, args);
      }
      return this;
    };
    return Emitter;
  })();
  
  var mixin = function(obj) {
    ["getListeners", "hasListeners", "on", "once", "off", "emit"].forEach(function(method) {
      if (!obj[method]) {
        obj[method] = Emitter.prototype[method];
      }
    });
    Emitter.call(obj);
    return obj;
  };
  
  module.exports = {
    Emitter: Emitter,
    mixin: mixin
  };

});
define('cc/client/node', function(require, exports, module) {

  var cc = require("./cc");
  var fn = require("./fn");
  var extend  = require("../common/extend");
  var utils   = require("./utils");
  var emitter = require("../common/emitter");

  var nodes = {};
  
  var Node = (function() {
    var nodeId = 0;
    function Node() {
      emitter.mixin(this);
      this.klassName = "Node";
      this.nodeId    = nodeId++;
      this._blocking  = true;
      nodes[this.nodeId] = this;
    }
    extend(Node, cc.Object);
    Node.prototype.play = fn.sync(function() {
      cc.client.pushToTimeline([
        "/n_run", this.nodeId, true
      ]);
      return this;
    });
    Node.prototype.pause = fn.sync(function() {
      cc.client.pushToTimeline([
        "/n_run", this.nodeId, false
      ]);
      return this;
    });
    Node.prototype.stop = fn.sync(function() {
      cc.client.pushToTimeline([
        "/n_free", this.nodeId
      ]);
      this._blocking = false;
      return this;
    });
    Node.prototype.performWait = function() {
      return this._blocking;
    };
    return Node;
  })();

  var Group = (function() {
    function Group(target, addAction) {
      Node.call(this);
      this.klassName = "Group";
      if (target) {
        var that = this;
        var timeline = cc.client.timeline;
        timeline.push(function() {
          cc.client.pushToTimeline([
            "/g_new", that.nodeId, addAction, target.nodeId
          ]);
        });
      }
    }
    extend(Group, Node);
    
    return Group;
  })();
  
  var Synth = (function() {
    function Synth(target, addAction, def, args) {
      Node.call(this);
      this.klassName = "Synth";
      this.params = def.specs.params;
      if (target) {
        var that = this;
        var timeline = cc.client.timeline;
        var controls = args2controls(args, this.params);
        timeline.push(function() {
          cc.client.pushToTimeline([
            "/s_new", that.nodeId, addAction, target.nodeId, def._defId, controls
          ]);
        });
      }
    }
    extend(Synth, Node);

    var args2controls = function(args, params) {
      var controls = [];
      if (utils.isDict(args)) {
        Object.keys(args).forEach(function(key) {
          var value  = args[key];
          var index  = params.names.indexOf(key);
          if (index === -1) {
            return;
          }
          index = params.indices[index];
          var length = params.length[index];
          if (Array.isArray(value)) {
            value.forEach(function(value, i) {
              if (i < length) {
                if (typeof value === "number" && !isNaN(value)) {
                  controls.push(index + i, value);
                }
              }
            });
          } else if (typeof value === "number" && !isNaN(value)) {
            controls.push(index, value);
          }
        });
      }
      return controls;
    };

    Synth.prototype._set = function(args) {
      var controls = args2controls(args, this.params);
      if (controls.length) {
        cc.client.pushToTimeline([
          "/n_set", this.nodeId, controls
        ]);
      }
    };
    
    Synth.prototype.set = fn.sync(Synth.prototype._set);
    
    return Synth;
  })();

  var SynthDef = (function() {
    var defId = 0;
    function SynthDef(func, args) {
      this.klassName = "SynthDef";
      this._defId = defId++;
      var isVaridArgs = false;
      if (args) {
        if (/^[ a-zA-Z0-9_$,.=\-\[\]]+$/.test(args)) {
          args = unpackArguments(args);
          if (args) {
            isVaridArgs = args.vals.every(function(item) {
              if (typeof item === "number") {
                return true;
              } else if (Array.isArray(item)) {
                return item.every(function(item) {
                  return typeof item === "number";
                });
              }
              if (item === undefined || item === null) {
                return true;
              }
              return false;
            });
          }
        }
        if (!isVaridArgs) {
          throw "UgenGraphFunc's arguments should be a constant number or an array that contains it.";
        }
      } else {
        args = { keys:[], vals:[] };
      }

      var children = [];
      cc.setSynthDef(function(ugen) {
        children.push(ugen);
      });
      
      var params  = { names:[], indices:[], length:[], values:[] };
      var flatten = [];
      var i, imax, length;
      for (i = 0, imax = args.vals.length; i < imax; ++i) {
        length = Array.isArray(args.vals[i]) ? args.vals[i].length : 1;
        params.names  .push(args.keys[i]);
        params.indices.push(flatten.length);
        params.length .push(length);
        params.values = params.values.concat(args.vals[i]);
        flatten = flatten.concat(args.vals[i]);
      }
      var reshaped = [];
      var controls = cc.createControl(1).init(flatten);
      if (!Array.isArray(controls)) {
        controls = [ controls ];
      }
      var saved = controls.slice();
      for (i = 0; i < imax; ++i) {
        if (Array.isArray(args.vals[i])) {
          reshaped.push(saved.splice(0, args.vals[i].length));
        } else {
          reshaped.push(saved.shift());
        }
      }
      
      try {
        func.apply(null, reshaped);
      } catch (e) {
        throw e.toString();
      } finally {
        cc.setSynthDef(null);
      }
      // console.log(children);
      var consts = [];
      children.forEach(function(x) {
        if (x.inputs) {
          x.inputs.forEach(function(_in) {
            if (typeof _in === "number" && consts.indexOf(_in) === -1) {
              consts.push(_in);
            }
          });
        }
      });
      consts.sort();
      var ugenlist = topoSort(children).filter(function(x) {
        return !(typeof x === "number" || cc.instanceOfOutputProxy(x));
      });
      // console.log(ugenlist);
      var defs = ugenlist.map(function(x) {
        var inputs = [];
        if (x.inputs) {
          x.inputs.forEach(function(x) {
            var index = ugenlist.indexOf((cc.instanceOfOutputProxy(x)) ? x.inputs[0] : x);
            var subindex = (index !== -1) ? x.outputIndex : consts.indexOf(x);
            inputs.push(index, subindex);
          });
        }
        var outputs;
        if (cc.instanceOfMultiOutUGen(x)) {
          outputs = x.channels.map(function(x) {
            return x.rate;
          });
        } else if (x.numOfOutputs === 1) {
          outputs = [ x.rate ];
        } else {
          outputs = [];
        }
        return [ x.klassName, x.rate, x.specialIndex|0, inputs, outputs, x.tag ];
      });
      var specs = {
        consts: consts,
        defs  : defs,
        params: params,
      };
      this.specs = specs;
      // console.log(specs);
      cc.client.pushToTimeline([
        "/s_def", this._defId, JSON.stringify(specs)
      ]);
      return this;
    }
    
    SynthDef.prototype.play = fn(function() {
      var target, args, addAction;
      var i = 0;
      if (arguments[i] instanceof Node) {
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
        if (args.target instanceof Node) {
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
        return SynthInterface.head(target, this, args);
      case "addToTail":
        return SynthInterface.tail(target, this, args);
      case "addBefore":
        return SynthInterface.before(target, this, args);
      case "addAfter":
        return SynthInterface.after(target, this, args);
      default:
        return SynthInterface.head(target, this, args);
      }
    }).multiCall().build();

    var topoSort = (function() {
      var _topoSort = function(x, list, checked) {
        checked.push(x);
        var index = list.indexOf(x);
        if (index !== -1) {
          list.splice(index, 1);
        }
        list.unshift(x);
        if (x.inputs) {
          x.inputs.forEach(function(x) {
            _topoSort(x, list, checked);
          });
        }
      };
      return function(list) {
        var checked = [];
        list.slice().forEach(function(x) {
          if (cc.instanceOfOut(x)) {
            checked.push(x);
            x.inputs.forEach(function(x) {
              _topoSort(x, list, checked);
            });
          }
        });
        list = list.filter(function(x) {
          return checked.indexOf(x) !== -1;
        });
        return list;
      };
    })();
    
    var splitArguments = function(args) {
      var result  = [];
      var begin   = 0;
      var bracket = 0;
      var inStr   = null;
      for (var i = 0, imax = args.length; i < imax; ++i) {
        var c = args.charAt(i);
        if (args.charAt(i-1) === "\\") {
          if (args.charAt(i-2) !== "\\") {
            continue;
          }
        }
        if (c === "\"" || c === "'") {
          if (inStr === null) {
            inStr = c;
          } else if (inStr === c) {
            inStr = null;
          }
        }
        if (inStr) {
          continue;
        }
        switch (c) {
        case ",":
          if (bracket === 0) {
            result.push(args.slice(begin, i).trim());
            begin = i + 1;
          }
          break;
        case "[":
          bracket += 1;
          break;
        case "]":
          bracket -= 1;
          break;
        }
      }
      if (begin !== i) {
        result.push(args.slice(begin, i).trim());
      }
      return result;
    };
    
    var unpackArguments = function(args) {
      var keys = [];
      var vals = [];
      if (args) {
        try {
          splitArguments(args).forEach(function(items) {
            var i = items.indexOf("=");
            var k, v;
            if (i === -1) {
              k = items;
              v = undefined;
            } else {
              k = items.substr(0, i).trim();
              v = JSON.parse(items.substr(i + 1));
            }
            keys.push(k);
            vals.push(v);
          });
        } catch (e) {
          return;
        }
      }
      return { keys:keys, vals:vals };
    };
    
    return SynthDef;
  })();

  var GroupInterface = function() {
    return new Group();
  };
  GroupInterface.after = function(node) {
    node = node || cc.client.rootNode;
    if (!(node instanceof Node)) {
      throw new TypeError("Group.after: arguments[0] is not a Node.");
    }
    return new Group(node, 3);
  };
  GroupInterface.before = function(node) {
    node = node || cc.client.rootNode;
    if (!(node instanceof Node)) {
      throw new TypeError("Group.before: arguments[0] is not a Node.");
    }
    return new Group(node, 2);
  };
  GroupInterface.head = function(node) {
    node = node || cc.client.rootNode;
    if (!(node instanceof Group)) {
      throw new TypeError("Group.head: arguments[0] is not a Group.");
    }
    return new Group(node, 0);
  };
  GroupInterface.tail = function(node) {
    node = node || cc.client.rootNode;
    if (!(node instanceof Group)) {
      throw new TypeError("Group.tail: arguments[0] is not a Group.");
    }
    return new Group(node, 1);
  };
  GroupInterface.replace = function(node) {
    if (!(node instanceof Node)) {
      throw new TypeError("Group.replace: arguments[0] is not a Node.");
    }
    return new Group(node, 4);
  };
  
  var SynthInterface = function() {
    return new Synth();
  };
  SynthInterface.def = function(func, args) {
    if (typeof func !== "function") {
      throw new TypeError("Synth.def: arguments[0] is not a Function.");
    }
    return new SynthDef(func, args);
  };
  SynthInterface.after = function() {
    var node, def, args;
    if (arguments[0] instanceof SynthDef) {
      node = cc.client.rootNode;
      def  = arguments[0];
      args = arguments[1] || {};
    } else if (arguments[1] instanceof SynthDef) {
      node = arguments[0];
      def  = arguments[1];
      args = arguments[2] || {};
    }
    if (!(node instanceof Node)) {
      throw new TypeError("Synth.after: arguments[0] is not a Node.");
    }
    if (!(def instanceof SynthDef)) {
      throw new TypeError("Synth.after: arguments[1] is not a SynthDef.");
    }
    return new Synth(node, 3, def, args);
  };
  SynthInterface.before = function() {
    var node, def, args;
    if (arguments[0] instanceof SynthDef) {
      node = cc.client.rootNode;
      def  = arguments[0];
      args = arguments[1] || {};
    } else if (arguments[1] instanceof SynthDef) {
      node = arguments[0];
      def  = arguments[1];
      args = arguments[2] || {};
    }
    if (!(node instanceof Node)) {
      throw new TypeError("Synth.before: arguments[0] is not a Node.");
    }
    if (!(def instanceof SynthDef)) {
      throw new TypeError("Synth.before: arguments[1] is not a SynthDef.");
    }
    return new Synth(node, 2, def, args);
  };
  SynthInterface.head = function() {
    var node, def, args;
    if (arguments[0] instanceof SynthDef) {
      node = cc.client.rootNode;
      def  = arguments[0];
      args = arguments[1] || {};
    } else if (arguments[1] instanceof SynthDef) {
      node = arguments[0];
      def  = arguments[1];
      args = arguments[2] || {};
    }
    if (!(node instanceof Group)) {
      throw new TypeError("Synth.head: arguments[0] is not a Group.");
    }
    if (!(def instanceof SynthDef)) {
      throw new TypeError("Synth.head: arguments[1] is not a SynthDef.");
    }
    return new Synth(node, 0, def, args);
  };
  SynthInterface.tail = function() {
    var node, def, args;
    if (arguments[0] instanceof SynthDef) {
      node = cc.client.rootNode;
      def  = arguments[0];
      args = arguments[1] || {};
    } else if (arguments[1] instanceof SynthDef) {
      node = arguments[0];
      def  = arguments[1];
      args = arguments[2] || {};
    }
    if (!(node instanceof Group)) {
      throw new TypeError("Synth.tail: arguments[0] is not a Group.");
    }
    if (!(def instanceof SynthDef)) {
      throw new TypeError("Synth.tail: arguments[1] is not a SynthDef.");
    }
    return new Synth(node, 1, def, args);
  };
  SynthInterface.replace = function(node, def, args) {
    if (!(node instanceof Node)) {
      throw new TypeError("Synth.replace: arguments[0] is not a Node.");
    }
    if (!(def instanceof SynthDef)) {
      throw new TypeError("Synth.replace: arguments[1] is not a SynthDef.");
    }
    return new Synth(node, 4, def, args);
  };
  
  var reset = function() {
    nodes = {};
  };

  var get = function(nodeId) {
    return nodes[nodeId];
  };
  
  cc.global.Group = GroupInterface;
  cc.global.Synth = SynthInterface;
  
  module.exports = {
    Node : Node,
    Group: Group,
    Synth: Synth,
    
    use: function() {
      require("./ugen/ugen").use();

      cc.createNode = function() {
        return new Node();
      };
      cc.createGroup = function(target, addAction) {
        return new Group(target, addAction);
      };
      cc.createSynth = function(target, addAction, def, args) {
        return new Synth(target, addAction, def, args);
      };
      cc.instanceOfNode = function(obj) {
        return obj instanceof Node;
      };
      cc.instanceOfGroup = function(obj) {
        return obj instanceof Group;
      };
      cc.instanceOfSynth = function(obj) {
        return obj instanceof Synth;
      };
      cc.getNode   = get;
      cc.resetNode = reset;
    }
  };

});
define('cc/client/ugen/ugen', function(require, exports, module) {
  
  var cc = require("../cc");
  var fn = require("../fn");
  var extend = require("../../common/extend");
  var slice  = [].slice;
  
  var addToSynthDef = null;
  var specs = {};
  
  var UGen = (function() {
    function UGen(name) {
      this.klassName = name;
      this.tag  = "";
      this.rate = 2;
      this.signalRange = 2;
      this.specialIndex = 0;
      this.outputIndex  = 0;
      this.numOfInputs  = 0;
      this.numOfOutputs = 1;
      this.inputs = [];
    }
    extend(UGen, cc.Object);
    
    UGen.prototype.init = function(rate) {
      this.rate = rate;
      if (addToSynthDef) {
        addToSynthDef(this);
      }
      this.inputs = slice.call(arguments, 1);
      this.numOfInputs = this.inputs.length;
      return this;
    };
    
    UGen.prototype.madd = fn(function(mul, add) {
      return cc.createMulAdd(this, mul, add);
    }).defaults("mul=1,add=0").multiCall().build();
    
    UGen.prototype.range = fn(function(lo, hi) {
      var mul, add;
      if (this.signalRange === 2) {
        mul = (hi - lo) * 0.5;
        add = mul + lo;
      } else {
        mul = (hi - lo);
        add = lo;
      }
      return cc.createMulAdd(this, mul, add);
    }).defaults("lo=0,hi=1").multiCall().build();
    
    UGen.prototype.unipolar = fn(function(mul) {
      return this.range(0, mul);
    }).defaults("mul=1").multiCall().build();
    
    UGen.prototype.bipolar = fn(function(mul) {
      return this.range(mul.neg(), mul);
    }).defaults("mul=1").multiCall().build();
    
    return UGen;
  })();
  
  var MultiOutUGen = (function() {
    function MultiOutUGen(name) {
      UGen.call(this, name || "MultiOutUGen");
      this.channels = null;
    }
    extend(MultiOutUGen, UGen);
    MultiOutUGen.prototype.initOutputs = function(numChannels, rate) {
      var channels = new Array(numChannels);
      for (var i = 0; i < numChannels; ++i) {
        channels[i] = new OutputProxy(rate, this, i);
      }
      this.channels = channels;
      this.numOfOutputs = channels.length;
      this.inputs = this.inputs.map(function(ugen) {
        if (!(ugen instanceof UGen)) {
          ugen = +ugen;
          if (isNaN(ugen)) {
            ugen = 0;
          }
        }
        return ugen;
      });
      this.numOfInputs = this.inputs.length;
      return (numChannels === 1) ? channels[0] : channels;
    };
    return MultiOutUGen;
  })();
  
  var OutputProxy = (function() {
    function OutputProxy(rate, source, index) {
      UGen.call(this, "OutputProxy");
      this.init(rate);
      this.inputs = [ source ];
      this.numOfOutputs = 1;
      this.outputIndex  = index;
    }
    extend(OutputProxy, UGen);
    return OutputProxy;
  })();
  
  
  var registerUGen = function(name, spec) {
    var klass = cc.global[name] = function() {
      return new UGen(name);
    };
    
    Object.keys(spec).forEach(function(key) {
      var setting   = spec[key];
      var defaults  = setting.defaults + ",tag";
      var ctor      = setting.ctor;
      var multiCall = setting.multiCall;
      if (multiCall === undefined) {
        multiCall = true;
      }
      if (setting.Klass !== null) {
        var Klass = setting.Klass || UGen;
        klass[key] = fn(function() {
          var args = slice.call(arguments, 0, arguments.length - 1);
          var tag  = arguments[arguments.length - 1];
          var instance = ctor.apply(new Klass(name, tag), args);
          if (instance instanceof UGen) {
            instance.tag = tag || "";
          }
          return instance;
        }).defaults(defaults).multiCall(multiCall).build();
      } else {
        klass[key] = fn(function() {
          var args = slice.call(arguments, 0, arguments.length - 1);
          var tag  = arguments[arguments.length - 1];
          var instance = ctor.apply(null, args);
          if (instance instanceof UGen) {
            instance.tag = tag || "";
          }
          return instance;
        }).defaults(defaults).multiCall(multiCall).build();
      }
    });
  };
  
  
  // exports for prototype extending
  cc.UGen = UGen;
  cc.MultiOutUGen = MultiOutUGen;
  cc.registerUGen = registerUGen;
  
  module.exports = {
    UGen        : UGen,
    MultiOutUGen: MultiOutUGen,
    OutputProxy : OutputProxy,
    specs       : specs,
    
    use: function() {
      cc.createUGen = function() {
        return new UGen();
      };
      cc.createOutputProxy = function(rate, source, index) {
        return new OutputProxy(rate, source, index);
      };
      cc.instanceOfUGen = function(obj) {
        return obj instanceof UGen;
      };
      cc.instanceOfMultiOutUGen = function(obj) {
        return obj instanceof MultiOutUGen;
      };
      cc.instanceOfOutputProxy = function(obj) {
        return obj instanceof OutputProxy;
      };
      cc.setSynthDef = function(func) {
        if (func && addToSynthDef !== null) {
          throw new Error("nested Synth.def");
        }
        addToSynthDef = func;
      };
      
      // redefinition for tests
      cc.UGen = UGen;
      cc.MultiOutUGen = MultiOutUGen;
      cc.registerUGen = registerUGen;
    },
    install: function() {
      require("./installer").install();
      Object.keys(specs).forEach(function(name) {
        registerUGen(name, specs[name]);
      });
    }
  };

});
define('cc/client/ugen/installer', function(require, exports, module) {
  
  module.exports = {
    use: function() {
      require("./ugen").use();
      require("./uop").use();
      require("./bop").use();
      require("./madd").use();
      require("./inout").use();
    },
    install: function() {
      require("./bufio");
      require("./delay");
      require("./inout");
      require("./line");
      require("./osc");
      require("./pan");
      require("./ui");
    }
  };

});
define('cc/client/ugen/uop', function(require, exports, module) {

  var cc = require("../cc");
  var extend = require("../../common/extend");
  var ops    = require("../../common/ops");
  
  var UnaryOpUGen = (function() {
    function UnaryOpUGen() {
      cc.UGen.call(this, "UnaryOpUGen");
    }
    extend(UnaryOpUGen, cc.UGen);

    UnaryOpUGen.prototype.init = function(selector, a) {
      var index = ops.UNARY_OP_UGEN_MAP.indexOf(selector);
      if (index === -1) {
        throw new TypeError("UnaryOpUGen: unknown operator '" + selector + "'");
      }
      var rate = a.rate|0;
      cc.UGen.prototype.init.call(this, rate);
      this.op = selector;
      this.specialIndex = index;
      this.inputs = [a];
      this.numOfInputs = 1;
      return this;
    };

    return UnaryOpUGen;
  })();
  
  
  module.exports = {
    use: function() {
      cc.createUnaryOpUGen = function(selector, a) {
        return new UnaryOpUGen().init(selector, a);
      };
      cc.instanceOfUnaryOpUGen = function(obj) {
        return obj instanceof UnaryOpUGen;
      };
    }
  };

});
define('cc/common/ops', function(require, exports, module) {

  var UNARY_OP_UGEN_MAP = "neg not isNil notNil bitNot abs asFloat asInt ceil floor frac sign squared cubed sqrt exp reciprocal midicps cpsmidi midiratio ratiomidi dbamp ampdb octcps cpsoct log log2 log10 sin cos tan asin acos atan sinh cosh tanh rand rand2 linrand bilinrand sum3rand distort softclip coin digitvalue silence thru rectWindow hanWindow welWindow triWindow ramp scurve numunaryselectors num tilde pi".split(" ");
  var BINARY_OP_UGEN_MAP = "+ - * / / % == != < > <= >= min max & | ^ lcm gcd round roundUp trunc atan2 hypot hypotApx pow << >> >>> fill ring1 ring2 ring3 ring4 difsqr sumsqr sqrsum sqrdif absdif thresh amclip scaleneg clip2 excess fold2 wrap2 firstarg randrange exprandrange numbinaryselectors".split(" ");
  
  module.exports = {
    UNARY_OP_UGEN_MAP : UNARY_OP_UGEN_MAP,
    BINARY_OP_UGEN_MAP: BINARY_OP_UGEN_MAP,
  };

});
define('cc/client/ugen/bop', function(require, exports, module) {

  var cc = require("../cc");
  var extend = require("../../common/extend");
  var ops    = require("../../common/ops");
  var utils  = require("../utils");
  
  var BinaryOpUGen = (function() {
    function BinaryOpUGen() {
      cc.UGen.call(this, "BinaryOpUGen");
    }
    extend(BinaryOpUGen, cc.UGen);
    
    BinaryOpUGen.prototype.init = function(selector, a, b) {
      if (selector === "-" && typeof b === "number") {
        selector = "+";
        b = -b;
      }
      if (selector === "/" && typeof b === "number") {
        selector = "*";
        b = 1 / b; // TODO: div(0) ?
      }
      if (selector === "*") {
        if (typeof a === "number" && typeof b === "number") {
          return a * b;
        } else if (a === 0 || b === 0) {
          return 0;
        }
        return optimizeMulObjects(a, b);
      }
      if (selector === "+") {
        if (typeof a === "number" && typeof b === "number") {
          return a + b;
        } else if (a === 0) {
          return b;
        } else if (b === 0) {
          return a;
        } else if (cc.instanceOfBinaryOpUGen(a)) {
          if (a.op === "*") {
            return cc.createMulAdd(a.inputs[0], a.inputs[1], b);
          }
        } else if (cc.instancrOfMulAdd(a)) {
          if (typeof a.inputs[2] === "number" && typeof b === "number") {
            if (a.inputs[2] + b === 0) {
              return cc.createBinaryOpUGen("*!", a.inputs[0], a.inputs[1]);
            } else {
              a.inputs[2] += b;
              return a;
            }
          }
          b = cc.createBinaryOpUGen("+", a.inputs[2], b);
          a = cc.createBinaryOpUGen("*!", a.inputs[0], a.inputs[1]);
          return cc.createBinaryOpUGen("+", a, b);
        }
        return optimizeSumObjects(a, b);
      }
      if (selector === "+!") {
        selector = "+";
      } else if (selector === "*!") {
        selector = "*";
      }
      
      var index = ops.BINARY_OP_UGEN_MAP.indexOf(selector);
      if (index === -1) {
        throw new TypeError("BinaryOpUGen: unknown operator '" + selector + "'");
      }
      var rate = Math.max(a.rate|0, b.rate|0);
      cc.UGen.prototype.init.call(this, rate);
      this.op = selector;
      this.specialIndex = index;
      this.inputs = [a, b];
      this.numOfInputs = 2;
      return this;
    };

    return BinaryOpUGen;
  })();
  
  var optimizeSumObjects = (function() {
    var collect = function(obj) {
      if (typeof obj === "number") {
        return obj;
      }
      var i = obj.inputs;
      if (cc.instanceOfBinaryOpUGen(obj) && obj.op === "+") {
        return [ collect(i[0]), collect(i[1]) ];
      } else if (cc.instanceOfSum3(obj)) {
        return [ collect(i[0]), collect(i[1]), collect(i[2]) ];
      } else if (cc.instanceOfSum4(obj)) {
        return [ collect(i[0]), collect(i[1]), collect(i[2]), collect(i[3]) ];
      }
      return obj;
    };
    var work = function(a) {
      a = a.map(function(a) {
        switch (a.length) {
        case 4: return cc.createSum4(a[0], a[1], a[2], a[3]);
        case 3: return cc.createSum3(a[0], a[1], a[2]);
        case 2: return cc.createBinaryOpUGen("+!", a[0], a[1]);
        case 1: return a[0];
        }
      });
      switch (a.length) {
      case 4: return cc.createSum4(a[0], a[1], a[2], a[3]);
      case 3: return cc.createSum4(a[0], a[1], a[2]);
      case 2: return cc.createBinaryOpUGen("+!", a[0], a[1]);
      case 1: return a[0];
      default: return work(utils.clump(a, 4));
      }
    };
    return function(in1, in2) {
      var list = utils.flatten([ collect(in1), collect(in2) ]);
      var fixnum = 0;
      list = list.filter(function(ugen) {
        if (typeof ugen === "number") {
          fixnum += ugen;
          return false;
        }
        return true;
      });
      if (fixnum !== 0) {
        list.push(fixnum);
      }
      list = utils.clump(list, 4);
      if (list.length === 1 && list[0].length === 2) {
        return cc.createBinaryOpUGen("+!", list[0][0], list[0][1]);
      }
      return work(list);
    };
  })();
  
  var optimizeMulObjects = (function() {
    var collect = function(obj) {
      if (typeof obj === "number") { return obj; }
      var i = obj.inputs;
      if (cc.instanceOfBinaryOpUGen(obj) && obj.op === "*") {
        return [ collect(i[0]), collect(i[1]) ];
      }
      return obj;
    };
    var work = function(a) {
      a = a.map(function(a) {
        if (a.length === 2) {
          return cc.createBinaryOpUGen("*!", a[0], a[1]);
        } else {
          return a[0];
        }
      });
      switch (a.length) {
      case 2:
        return cc.createBinaryOpUGen("*!", a[0], a[1]);
      case 1:
        return a[0];
      default:
        return work(utils.clump(a, 2));
      }
    };
    return function(in1, in2) {
      var list = utils.flatten([ collect(in1), collect(in2) ]);
      var fixnum = 1;
      list = list.filter(function(ugen) {
        if (typeof ugen === "number") {
          fixnum *= ugen;
          return false;
        }
        return true;
      });
      if (fixnum !== 1) {
        list.push(fixnum);
      }
      list = utils.clump(list, 2);
      if (list.length === 1 && list[0].length === 2) {
        return cc.createBinaryOpUGen("*!", list[0][0], list[0][1]);
      }
      return work(list);
    };
  })();
  
  
  module.exports = {
    use: function() {
      cc.createBinaryOpUGen = function(selector, a, b) {
        return new BinaryOpUGen().init(selector, a, b);
      };
      cc.instanceOfBinaryOpUGen = function(obj) {
        return obj instanceof BinaryOpUGen;
      };
    }
  };

});
define('cc/client/ugen/madd', function(require, exports, module) {
  
  var cc = require("../cc");
  var extend = require("../../common/extend");
  
  var asRate = function(obj) {
    if (Array.isArray(obj)) {
      return obj.reduce(function(rate, obj) {
        return Math.max(rate, asRate(obj));
      }, 0);
    }
    return (obj && obj.rate) || 0;
  };
  
  var MulAdd = (function() {
    function MulAdd() {
      cc.UGen.call(this, "MulAdd");
    }
    extend(MulAdd, cc.UGen);

    MulAdd.prototype.init = function(_in, mul, add) {
      var t, minus, nomul, noadd, rate;
      if (_in.rate - mul.rate < 0) {
        t = _in; _in = mul; mul = t;
      }
      if (mul === 0) {
        return add;
      }
      minus = mul === -1;
      nomul = mul ===  1;
      noadd = add ===  0;
      
      if (nomul && noadd) {
        return _in;
      }
      if (minus && noadd) {
        return cc.createBinaryOpUGen("*", _in, -1);
      }
      if (noadd) {
        return cc.createBinaryOpUGen("*", _in, mul);
      }
      if (minus) {
        return cc.createBinaryOpUGen("-", add, _in);
      }
      if (nomul) {
        return cc.createBinaryOpUGen("+", _in, add);
      }
      if (validate(_in, mul, add)) {
        rate = asRate([_in, mul, add]);
        return cc.UGen.prototype.init.apply(this, [rate, _in, mul, add]);
      }
      if (validate(mul, _in, add)) {
        rate = asRate([mul, _in, add]);
        return cc.UGen.prototype.init.apply(this, [rate, mul, _in, add]);
      }
      return _in * mul + add;
    };
    
    var validate = function(_in, mul, add) {
      _in = asRate(_in);
      mul = asRate(mul);
      add = asRate(add);
      if (_in === 2) {
        return true;
      }
      if (_in === 1 &&
          (mul === 1 || mul === 0) &&
          (add === 1 || add === 0)) {
        return true;
      }
      return false;
    };
    
    return MulAdd;
  })();
  
  var Sum3 = (function() {
    function Sum3() {
      cc.UGen.call(this, "Sum3");
       }
    extend(Sum3, cc.UGen);
    
    Sum3.prototype.init = function(in0, in1, in2) {
      if (in0 === 0) {
        return cc.createBinaryOpUGen("+", in1, in2);
      }
      if (in1 === 0) {
        return cc.createBinaryOpUGen("+", in0, in2);
      }
      if (in2 === 0) {
        return cc.createBinaryOpUGen("+", in0, in1);
      }
      var rate = asRate([in0, in1, in2]);
      var sortedArgs = [in0, in1, in2].sort(function(a, b) {
        return b.rate - a.rate;
      });
      return cc.UGen.prototype.init.apply(this, [rate].concat(sortedArgs));
    };
    
    return Sum3;
  })();

  var Sum4 = (function() {
    function Sum4() {
      cc.UGen.call(this, "Sum4");
    }
    extend(Sum4, cc.UGen);
    
    Sum4.prototype.init = function(in0, in1, in2, in3) {
      if (in0 === 0) {
        return cc.createSum3(in1, in2, in3);
      }
      if (in1 === 0) {
        return cc.createSum3(in0, in2, in3);
      }
      if (in2 === 0) {
        return cc.createSum3(in0, in1, in3);
      }
      if (in3 === 0) {
        return cc.createSum3(in0, in1, in2);
      }
      var rate = asRate([in0, in1, in2, in3]);
      var sortedArgs = [in0, in1, in2, in3].sort(function(a, b) {
        return b.rate - a.rate;
      });
      return cc.UGen.prototype.init.apply(this, [rate].concat(sortedArgs));
    };
    
    return Sum4;
  })();
  
  
  module.exports = {
    use: function() {
      cc.createMulAdd = function(_in, mul, add) {
        return new MulAdd().init(_in, mul, add);
      };
      cc.createSum3 = function(in0, in1, in2) {
        return new Sum3().init(in0, in1, in2);
      };
      cc.createSum4 = function(in0, in1, in2, in3) {
        return new Sum4().init(in0, in1, in2, in3);
      };
      cc.instanceOfMulAdd = function(obj) {
        return obj instanceof MulAdd;
      };
      cc.instanceOfSum3 = function(obj) {
        return obj instanceof Sum3;
      };
      cc.instanceOfSum4 = function(obj) {
        return obj instanceof Sum4;
      };
    }
  };

});
define('cc/client/ugen/inout', function(require, exports, module) {

  var cc = require("../cc");
  var extend = require("../../common/extend");
  var ugen  = require("./ugen");
  var utils = require("../utils");

  var Control = (function() {
    function Control(rate) {
      cc.MultiOutUGen.call(this, "Control");
      this.rate   = rate;
      this.values = null;
    }
    extend(Control, cc.MultiOutUGen);
    Control.prototype.init = function(list) {
      cc.UGen.prototype.init.apply(this, [this.rate].concat(list));
      this.values = list.slice();
      return this.initOutputs(this.values.length, this.rate);
    };
    return Control;
  })();
  
  ugen.specs.In = {
    ar: {
      defaults: "bus=0,numChannels=1",
      ctor: function(bus, numChannels) {
        this.init.call(this, 2);
        this.inputs = [ bus ];
        return this.initOutputs(numChannels, this.rate);
      },
      Klass: cc.MultiOutUGen
    },
    kr: {
      defaults: "bus=0,numChannels=1",
      ctor: function(bus, numChannels) {
        this.init.call(this, 1);
        this.inputs = [ bus ];
        return this.initOutputs(numChannels, this.rate);
      },
      Klass: cc.MultiOutUGen
    }
  };
  
  
  
  var Out = (function() {
    function Out() {
      cc.UGen.call(this, "Out");
    }
    extend(Out, cc.UGen);
    return Out;
  })();
  
  var out_ctor = function(rate) {
    function ctor(bus, channelsArray) {
      if (!(cc.instanceOfUGen(bus) || typeof bus === "number")) {
        throw new TypeError("Out: arguments[0] should be an UGen or a number.");
      }
      if (!Array.isArray(channelsArray)) {
        channelsArray = [ channelsArray ];
      }
      channelsArray = utils.flatten(channelsArray);
      channelsArray = channelsArray.filter(function(x) {
        return x !== 0;
      });
      if (channelsArray.length) {
        cc.UGen.prototype.init.apply(new Out(), [rate, bus].concat(channelsArray));
      }
    }
    return function(bus, channelsArray) {
      if (Array.isArray(bus)) {
        bus.forEach(function(bus) {
          ctor(bus, channelsArray);
        });
      } else {
        ctor(bus, channelsArray);
      }
      return 0; // Out has no output
    };
  };
  
  ugen.specs.Out = {
    ar: {
      defaults: "bus=0,channelsArray=0",
      ctor: out_ctor(2),
      multiCall: false,
      Klass: null
    },
    kr: {
      defaults: "bus=0,channelsArray=0",
      ctor: out_ctor(1),
      multiCall: false,
      Klass: null
    }
  };
  
  module.exports = {
    use: function() {
      cc.createControl = function(rate) {
        return new Control(rate);
      };
      cc.instanceOfOut = function(obj) {
        return obj instanceof Out;
      };
    }
  };

});
define('cc/client/ugen/bufio', function(require, exports, module) {

  var cc = require("../cc");
  var ugen = require("./ugen");
  
  var slice = [].slice;

  var playbuf_ctor = function(rate) {
    return function(numChannels, buffer) {
      if (typeof numChannels !== "number") {
        throw new TypeError("Buffer: arguments[0] should be an integer.");
      }
      if (!cc.instanceOfAudioBuffer(buffer)) {
        throw new TypeError("Buffer: arguments[1] should be a buffer.");
      }
      numChannels = Math.max(0, numChannels|0);
      this.init.apply(this, [rate].concat(slice.call(arguments, 1)));
      this.specialIndex = buffer._bufId;
      return this.initOutputs(numChannels, this.rate);
    };
  };
  
  ugen.specs.PlayBuf = {
    ar: {
      defaults: "numChannels=0,buffer,rate=1,trigger=1,startPos=0,loop=0,doneAction=0",
      ctor: playbuf_ctor(2),
      Klass: cc.MultiOutUGen
    },
    kr: {
      defaults: "numChannels=0,buffer,rate=1,trigger=1,startPos=0,loop=0,doneAction=0",
      ctor: playbuf_ctor(1),
      Klass: cc.MultiOutUGen
    },
  };
  
  module.exports = {};

});
define('cc/client/ugen/delay', function(require, exports, module) {
  
  var ugen = require("./ugen");
  
  var Comb = {
    ar: {
      defaults: "in=0,maxdelaytime=0.2,delaytime=0.2,decaytime=1,mul=1,add=0",
      ctor: function(_in, maxdelaytime, delaytime, decaytime, mul, add) {
        return this.init(2, _in, maxdelaytime, delaytime, decaytime).madd(mul, add);
      }
    },
    kr: {
      defaults: "in=0,maxdelaytime=0.2,delaytime=0.2,decaytime=1,mul=1,add=0",
      ctor: function(_in, maxdelaytime, delaytime, decaytime, mul, add) {
        return this.init(2, _in, maxdelaytime, delaytime, decaytime).madd(mul, add);
      }
    },
  };
  ugen.specs.CombN = Comb;
  ugen.specs.CombL = Comb;
  ugen.specs.CombC = Comb;
  
  module.exports = {};

});
define('cc/client/ugen/line', function(require, exports, module) {
  
  var ugen = require("./ugen");
  
  ugen.specs.Line = {
    ar: {
      defaults: "start=0,end=1,dur=1,mul=1,add=0,doneAction=0",
      ctor: function(start, end, dur, mul, add, doneAction) {
        return this.init(2, start, end, dur, doneAction).madd(mul, add);
      }
    },
    kr: {
      defaults: "start=0,end=1,dur=1,mul=1,add=0,doneAction=0",
      ctor: function(start, end, dur, mul, add, doneAction) {
        return this.init(1, start, end, dur, doneAction).madd(mul, add);
      }
    }
  };
  
  module.exports = {};

});
define('cc/client/ugen/osc', function(require, exports, module) {
  
  var ugen = require("./ugen");
  
  ugen.specs.SinOsc = {
    ar: {
      defaults: "freq=440,phase=0,mul=1,add=0",
      ctor: function(freq, phase, mul, add) {
        return this.init(2, freq, phase).madd(mul, add);
      }
    },
    kr: {
      defaults: "freq=440,phase=0,mul=1,add=0",
      ctor: function(freq, phase, mul, add) {
        return this.init(1, freq, phase).madd(mul, add);
      }
    }
  };

  ugen.specs.LFSaw = {
    ar: {
      defaults: "freq=440,iphase=0,mul=1,add=0",
      ctor: function(freq, iphase, mul, add) {
        return this.init(2, freq, iphase).madd(mul, add);
      }
    },
    kr: {
      defaults: "freq=440,iphase=0,mul=1,add=0",
      ctor: function(freq, iphase, mul, add) {
        return this.init(1, freq, iphase).madd(mul, add);
      }
    }
  };
  
  module.exports = {};

});
define('cc/client/ugen/pan', function(require, exports, module) {

  var cc = require("../cc");
  var ugen = require("./ugen");

  var pan2_ctor = function(rate) {
    return function(_in, pos, level) {
      this.init.call(this, rate, _in, pos, level);
      this.channels = [
        cc.createOutputProxy(this.rate, this, 0),
        cc.createOutputProxy(this.rate, this, 1),
      ];
      this.numOfOutputs = 2;
      return this.channels;
    };
  };
  
  ugen.specs.Pan2 = {
    ar: {
      defaults: "in=0,pos=0,level=1",
      ctor: pan2_ctor(2),
      Klass: cc.MultiOutUGen
    },
    kr: {
      defaults: "in=0,pos=0,level=1",
      ctor: pan2_ctor(1),
      Klass: cc.MultiOutUGen
    },
  };
  
  module.exports = {};

});
define('cc/client/ugen/ui', function(require, exports, module) {
  
  var ugen = require("./ugen");
  
  var MouseXY = {
    kr: {
      defaults: "minval=0,maxval=1,warp=0,lag=0.2",
      ctor: function(minval, maxval, warp, lag) {
        if (warp === "exponential") {
          warp = 1;
        } else if (typeof warp !== "number") {
          warp = 0;
        }
        return this.init(1, minval, maxval, warp, lag);
      }
    }
  };
  ugen.specs.MouseX = MouseXY;
  ugen.specs.MouseY = MouseXY;
  
  ugen.specs.MouseButton = {
    kr: {
      defaults: "minval=0,maxval=1,lag=0.2",
      ctor: function(minval, maxval, lag) {
        return this.init(1, minval, maxval, lag);
      }
    }
  };
  
  module.exports = {};

});
define('cc/client/sched', function(require, exports, module) {

  var cc = require("./cc");
  var fn = require("./fn");
  var extend = require("../common/extend");
  var emitter = require("../common/emitter");
  
  var Timeline = (function() {
    function Timeline() {
      this.klassName = "Timeline";
      this.reset();
    }
    extend(Timeline, cc.Object);
    
    Timeline.prototype.play = function(counterIncr) {
      this.counterIncr = counterIncr;
    };
    Timeline.prototype.pause = function() {
      this.counterIncr = 0;
    };
    Timeline.prototype.reset = function() {
      var taskGlobal = cc.createTaskGlobal(this);
      this._list   = [ taskGlobal ];
      this._stack  = [ taskGlobal ];
      this.context = taskGlobal.context;
    };
    Timeline.prototype.append = function(sched) {
      var index = this._list.indexOf(sched);
      if (index === -1) {
        this._list.push(sched);
      }
    };
    Timeline.prototype.remove = function(sched) {
      var index = this._list.indexOf(sched);
      if (index !== -1) {
        this._list.splice(index, 1);
      }
    };
    Timeline.prototype.push = function(that, func, args) {
      this._stack[this._stack.length - 1].push(that, func, args);
    };
    Timeline.prototype.process = function() {
      var counterIncr = this.counterIncr;
      if (counterIncr) {
        var _list = this._list;
        for (var i = 0; i < _list.length; ++i) {
          _list[i].process(counterIncr);
        }
      }
    };
    
    return Timeline;
  })();
  
  var TaskWaitToken = (function() {
    function TaskWaitToken(item) {
      emitter.mixin(this);
      this.klassName = "TaskWaitToken";
      this.item = item;
      this._blocking = true;
    }
    extend(TaskWaitToken, cc.Object);
    
    TaskWaitToken.prototype.performWait = function() {
      if (this._blocking) {
        this._blocking = !!this.item;
        if (!this._blocking) {
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitToken;
  })();

  var TaskWaitTokenNumber = (function() {
    function TaskWaitTokenNumber(item) {
      TaskWaitToken.call(this, item);
      this.klassName = "TaskWaitTokenNumber";
    }
    extend(TaskWaitTokenNumber, TaskWaitToken);
    
    TaskWaitTokenNumber.prototype.performWait = function(counterIncr) {
      if (this._blocking) {
        this.item -= counterIncr;
        if (this.item <= 0) {
          this._blocking = false;
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitTokenNumber;
  })();

  var TaskWaitTokenFunction = (function() {
    function TaskWaitTokenFunction(item) {
      TaskWaitToken.call(this, item);
      this.klassName = "TaskWaitTokenFunction";
    }
    extend(TaskWaitTokenFunction, TaskWaitToken);
    
    TaskWaitTokenFunction.prototype.performWait = function() {
      if (this._blocking) {
        this._blocking = !!this.item();
        if (!this._blocking) {
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitTokenFunction;
  })();

  var TaskWaitTokenBoolean = (function() {
    function TaskWaitTokenBoolean(item) {
      TaskWaitToken.call(this, item);
      this.klassName = "TaskWaitTokenBoolean";
    }
    extend(TaskWaitTokenBoolean, TaskWaitToken);
    
    TaskWaitTokenBoolean.prototype.performWait = function() {
      if (this._blocking) {
        this._blocking = this.item;
        if (!this._blocking) {
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitTokenBoolean;
  })();
  
  var TaskWaitTokenBlock = (function() {
    function TaskWaitTokenBlock(item) {
      TaskWaitToken.call(this, item);
      this.klassName = "TaskWaitTokenBlock";
    }
    extend(TaskWaitTokenBlock, TaskWaitToken);
    
    TaskWaitTokenBlock.prototype.performWait = function(counterIncr) {
      if (this._blocking) {
        this._blocking = this.item.performWait(counterIncr);
        if (!this._blocking) {
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitTokenBlock;
  })();

  var TaskWaitAND = (function() {
    function TaskWaitAND(list) {
      emitter.mixin(this);
      this.klassName = "TaskWaitAND";
      var items = [];
      list.forEach(function(x) {
        if (x instanceof TaskWaitAND) {
          items = items.concat(x.list);
        } else {
          items.push(x);
        }
      });
      this.items = items;
      this._blocking = true;
    }
    extend(TaskWaitAND, TaskWaitToken);
    
    TaskWaitAND.prototype.performWait = function(counterIncr) {
      if (this._blocking) {
        this._blocking = this.items.reduce(function(_blocking, item) {
          return item.performWait(counterIncr) || _blocking;
        }, false);
      }
      if (!this._blocking) {
        this.emit("end");
      }
      return this._blocking;
    };
    
    return TaskWaitAND;
  })();

  var TaskWaitOR = (function() {
    function TaskWaitOR(list) {
      emitter.mixin(this);
      this.klassName = "TaskWaitOR";
      var items = [];
      list.forEach(function(x) {
        if (x instanceof TaskWaitOR) {
          items = items.concat(x.list);
        } else {
          items.push(x);
        }
      });
      this.items = items;
      this._blocking = true;
    }
    extend(TaskWaitOR, TaskWaitToken);
    
    TaskWaitOR.prototype.performWait = function(counterIncr) {
      if (this._blocking) {
        this._blocking = this.items.reduce(function(_blocking, item) {
          return item.performWait(counterIncr) && _blocking;
        }, true);
        if (!this._blocking) {
          this.emit("end");
        }
      }
      return this._blocking;
    };
    
    return TaskWaitOR;
  })();
  
  var TaskContext = (function() {
    function TaskContext(task) {
      this.klassName = "TaskContext";
      this.wait = function(item) {
        var token = cc.createTaskWaitToken(item);
        task._queue.push(token);
        return token;
      };
      this.pause = function() {
        task.pause();
      };
      this.stop = function() {
        task.stop();
      };
    }
    return TaskContext;
  })();
  
  var Task = (function() {
    function Task() {
      emitter.mixin(this);
      this.klassName = "Task";
      this._blocking  = true;
      this.timeline  = cc.timeline;
      this.context   = cc.createTaskContext(this);
      this._queue = [];
      this._bang  = false;
      this._index = 0;
      this._prev  = null;
      this._next  = null;
    }
    extend(Task, cc.Object);
    
    Task.prototype.play = fn.sync(function() {
      var that = this;
      // rewind to the head task of a chain
      while (that._prev !== null) {
        that = that._prev;
      }
      if (that.timeline) {
        that.timeline.append(that);
      }
      if (that._queue.length === 0) {
        that._bang = true;
      }
    });
    Task.prototype.pause = fn.sync(function() {
      if (this.timeline) {
        this.timeline.remove(this);
      }
      this._bang = false;
    });
    Task.prototype.stop = fn.sync(function() {
      if (this.timeline) {
        this.timeline.remove(this);
      }
      this._bang = false;
      this.timeline = null;
      this._blocking = false;
      this.emit("end");
      if (this._next) {
        this._next._prev = null;
        this._next.play();
        this._next = null;
      }
    });
    Task.prototype.performWait = function() {
      return this._blocking;
    };

    // task chain methods
    Task.prototype["do"] = function(func) {
      var next = cc.createTaskDo(func);
      next._prev = this;
      this._next = next;
      return next;
    };
    Task.prototype.loop = function(func) {
      var next = cc.createTasLoop(func);
      next._prev = this;
      this._next = next;
      return next;
    };
    Task.prototype.each = function(list, func) {
      var next = cc.createTaskEach(list, func);
      next._prev = this;
      this._next = next;
      return next;
    };
    Task.prototype.timeout = function(delay, func) {
      var next = cc.createTaskTimeout(delay, func);
      next._prev = this;
      this._next = next;
      return next;
    };
    Task.prototype.interval = function(delay, func) {
      var next = cc.createTaskInterval(delay, func);
      next._prev = this;
      this._next = next;
      return next;
    };

    
    Task.prototype.push = function(that, func, args) {
      if (typeof that === "function") {
        this._queue.push([that, null, args]);
      } else {
        this._queue.push([func, that, args]);
      }
    };
    Task.prototype.done = function() {
      // should be overridden
    };
    Task.prototype.process = function(counterIncr) {
      var timeline = this.timeline;
      var _queue   = this._queue;
      var continuance = false;
      do {
        if (this._bang) {
          timeline._stack.push(this);
          this._execute();
          this._index += 1;
          timeline._stack.pop();
          this._bang = false;
        }
        var i = 0;
        LOOP:
        while (i < _queue.length) {
          var e = _queue[i];
          if (Array.isArray(e)) {
            e[0].apply(e[1], e[2]);
          } else {
            if (e.performWait) {
              if (e.performWait(counterIncr)) {
                break LOOP;
              }
            }
          }
          i += 1;
        }
        continuance = false;
        if (i) {
          _queue.splice(0, i);
          if (_queue.length === 0) {
            continuance = this.done();
          }
        }
      } while (continuance);
    };
    return Task;
  })();
  
  var TaskGlobal = (function() {
    function TaskGlobal(timeline) {
      Task.call(this, timeline);
      this.klassName = "TaskGlobal";
    }
    extend(TaskGlobal, Task);
    
    TaskGlobal.prototype.play  = function() {};
    TaskGlobal.prototype.pause = function() {};
    TaskGlobal.prototype.stop  = function() {};
    
    return TaskGlobal;
  })();
  
  var TaskDo = (function() {
    function TaskDo(func) {
      if (typeof func !== "function") {
        throw new TypeError("Task.do: First argument must be a Function.");
      }
      Task.call(this);
      this.klassName = "TaskDo";
      this.func = func;
    }
    extend(TaskDo, Task);

    TaskDo.prototype._execute = function() {
      this.func.call(this.context, this._index);
    };
    TaskDo.prototype.done = function() {
      this.stop();
    };
    
    return TaskDo;
  })();
  
  var TaskLoop = (function() {
    function TaskLoop(func) {
      if (typeof func !== "function") {
        throw new TypeError("Task.loop: First argument must be a Function.");
      }
      TaskDo.call(this, func);
      this.klassName = "TaskLoop";
    }
    extend(TaskLoop, TaskDo);

    TaskLoop.prototype.done = function() {
      this._bang = true;
    };
    
    return TaskLoop;
  })();

  var TaskEach = (function() {
    function TaskEach(list, func) {
      if (!(Array.isArray(list))) {
        throw new TypeError("Task.each: First argument must be an Array.");
      }
      if (typeof func !== "function") {
        throw new TypeError("Task.each: Second argument must be a Function.");
      }
      Task.call(this);
      this.klassName = "TaskEach";
      this.list = list;
      this.func = func;
    }
    extend(TaskEach, Task);

    TaskEach.prototype._execute = function() {
      if (this._index < this.list.length) {
        this.func.call(this.context, this.list[this._index], this._index);
      }
    };
    TaskEach.prototype.done = function() {
      if (this._index < this.list.length) {
        this._bang = true;
      } else {
        this.stop();
      }
    };
    
    return TaskEach;
  })();

  var TaskTimeout = (function() {
    function TaskTimeout(delay, func) {
      if (typeof delay !== "number") {
        throw new TypeError("Task.timeout: First argument must be a Number.");
      }
      if (typeof func !== "function") {
        throw new TypeError("Task.timeout: Second argument must be a Function.");
      }
      Task.call(this);
      this.klassName = "TaskTimeout";
      delay = Math.max(0, delay);
      if (isNaN(delay)) {
        delay = 0;
      }
      this.func = func;
      this._queue.push(cc.createTaskWaitToken(delay));
    }
    extend(TaskTimeout, Task);
    
    TaskTimeout.prototype._execute = function() {
      this.func.call(this.context, this._index);
    };
    TaskTimeout.prototype.done = function() {
      if (this._index === 0) {
        this._bang = true;
        return true;
      }
      this.stop();
    };
    
    return TaskTimeout;
  })();
  
  var TaskInterval = (function() {
    function TaskInterval(delay, func) {
      if (typeof delay !== "number") {
        throw new TypeError("Task.interval: First argument must be a Number.");
      }
      if (typeof func !== "function") {
        throw new TypeError("Task.interval: Second argument must be a Function.");
      }
      TaskTimeout.call(this, delay, func);
      this.klassName = "TaskInterval";
    }
    extend(TaskInterval, TaskTimeout);

    TaskInterval.prototype.done = function() {
      this._bang = true;
      return true;
    };
    
    return TaskInterval;
  })();
  
  var TaskBlock = (function() {
    function TaskBlock(count) {
      this.klassName = "TaskBlock";
      if (typeof count !== "number") {
        count = 1;
      }
      this._count = count;
      this._blocking = true;
    }
    TaskBlock.prototype.lock = fn.sync(function(count) {
      if (typeof count !== "number") {
        count = 1;
      }
      this._count += count;
    });
    TaskBlock.prototype.free = fn.sync(function(count) {
      if (typeof count !== "number") {
        count = 1;
      }
      this._count -= count;
      if (this._count <= 0) {
        this._blocking = false;
      }
    });
    TaskBlock.prototype.performWait = function() {
      return this._blocking;
    };
    return TaskBlock;
  })();
  
  cc.global.Task = {
    "do": function(func) {
      return cc.createTaskDo(func);
    },
    loop: function(func) {
      return cc.createTaskLoop(func);
    },
    each: function(list, func) {
      return cc.createTaskEach(list, func);
    },
    timeout: function(delay, func) {
      return cc.createTaskTimeout(delay, func);
    },
    interval: function(delay, func) {
      return cc.createTaskInterval(delay, func);
    },
    block: function() {
      return cc.createTaskBlock();
    }
  };
  
  module.exports = {
    Timeline: Timeline,
    TaskWaitToken        : TaskWaitToken,
    TaskWaitTokenNumber  : TaskWaitTokenNumber,
    TaskWaitTokenFunction: TaskWaitTokenFunction,
    TaskWaitTokenBoolean : TaskWaitTokenBoolean,
    TaskWaitTokenBlock   : TaskWaitTokenBlock,
    TaskWaitAND : TaskWaitAND,
    TaskWaitOR  : TaskWaitOR,
    TaskContext : TaskContext,
    Task        : Task,
    TaskGlobal  : TaskGlobal,
    TaskDo      : TaskDo,
    TaskLoop    : TaskLoop,
    TaskEach    : TaskEach,
    TaskTimeout : TaskTimeout,
    TaskInterval: TaskInterval,
    TaskBlock   : TaskBlock,
    
    use: function() {
      cc.createTimeline = function() {
        cc.timeline = new Timeline();
        return cc.timeline;
      };
      cc.createTaskGlobal = function(timeline) {
        return new TaskGlobal(timeline);
      };
      cc.createTaskDo = function(func) {
        return new TaskDo(func);
      };
      cc.createTaskLoop = function(func) {
        return new TaskLoop(func);
      };
      cc.createTaskEach = function(list, func) {
        return new TaskEach(list, func);
      };
      cc.createTaskTimeout = function(delay, func) {
        return new TaskTimeout(delay, func);
      };
      cc.createTaskInterval = function(delay, func) {
        return new TaskInterval(delay, func);
      };
      cc.createTaskBlock = function() {
        return new TaskBlock();
      };
      cc.createTaskContext = function(task) {
        return new TaskContext(task);
      };
      cc.createTaskWaitToken = function(item) {
        if (item instanceof TaskWaitToken) {
          return item;
        }
        switch (typeof item) {
        case "number":
          return new TaskWaitTokenNumber(item);
        case "function":
          return new TaskWaitTokenFunction(item);
        case "boolean":
          return new TaskWaitTokenBoolean(item);
        default:
          if (item) {
            if (Array.isArray(item)) {
              return cc.createTaskWaitLogic("and", item);
            } else if (typeof item.performWait === "function") {
              return new TaskWaitTokenBlock(item);
            }
          }
        }
        throw new TypeError("TaskWaitToken: Invalid type");
      };
      cc.createTaskWaitLogic = function(logic, list) {
        list = list.map(function(x) {
          return cc.createTaskWaitToken(x);
        });
        return (logic === "and") ? new TaskWaitAND(list) : new TaskWaitOR(list);
      };
      cc.instanceOfWaitToken = function(obj) {
        return obj instanceof TaskWaitToken;
      };
    }
  };

});
define('cc/client/random', function(require, exports, module) {
  
  var cc = require("./cc");
  var extend = require("../common/extend");
  
  var Random = (function() {
    function Random(seed) {
      if (typeof seed !== "number") {
        seed = Date.now();
      }
      var hash = seed;
      hash += ~(hash <<  15);
      hash ^=   hash >>> 10;
      hash +=   hash <<  3;
      hash ^=   hash >>> 6;
      hash += ~(hash <<  11);
      hash ^=   hash >>> 16;

      this.s1 = 1243598713 ^ seed;
      this.s2 = 3093459404 ^ seed;
      this.s3 = 1821928721 ^ seed;
      if (this.s1 <  2) {
        this.s1 = 1243598713;
      }
      if (this.s2 <  8) {
        this.s2 = 3093459404;
      }
      if (this.s3 < 16) {
        this.s3 = 1821928721;
      }
    }
    extend(Random, cc.Object);

    Random.prototype.trand = function() {
      this.s1 = ((this.s1 & 4294967294) << 12) ^ (((this.s1 << 13) ^  this.s1) >>> 19);
      this.s2 = ((this.s2 & 4294967288) <<  4) ^ (((this.s2 <<  2) ^  this.s2) >>> 25);
      this.s3 = ((this.s3 & 4294967280) << 17) ^ (((this.s3 <<  3) ^  this.s3) >>> 11);
      return this.s1 ^ this.s2 ^ this.s3;
    };

    var _i = new Uint32Array(1);
    var _f = new Float32Array(_i.buffer);
    
    Random.prototype.next = function() {
      _i[0] = 0x3F800000 | (this.trand() >>> 9);
      return _f[0] - 1;
    };
    
    return Random;
  })();

  cc.global.Random  = function(seed) {
    return cc.createRandom(seed);
  };
  
  module.exports = {
    Random: Random,
    use: function() {
      cc.createRandom = function(seed) {
        return new Random(seed);
      };
      cc.instanceOfRandom = function(obj) {
        return obj instanceof Random;
      };
    }
  };

});
define('cc/client/object', function(require, exports, module) {

  var cc = require("./cc");
  var fn = require("./fn");
  var utils = require("./utils");
  
  var setup = function(key, func) {
    [cc.Object, Array, Boolean, Date, Function, Number, String].forEach(function(Klass) {
      fn.definePrototypeProperty(Klass, key, func);
    });
  };

  var setupUnaryOperator = function(selector, func, ugenSelector) {
    ugenSelector = ugenSelector || selector;
    [cc.Object, Boolean, Date, Function, Number, String].forEach(function(Klass) {
      fn.definePrototypeProperty(Klass, selector, func);
    });
    fn.definePrototypeProperty(Array, selector, function() {
      return this.map(function(x) {
        return x[selector]();
      });
    });
    fn.definePrototypeProperty(cc.UGen, selector, function() {
      return cc.createUnaryOpUGen(ugenSelector, this);
    });
  };

  var makeBinaryOpFunction = function(func, selector) {
    return function(b) {
      if (Array.isArray(b)) {
        return b.map(function(b) {
          return this[selector](b);
        }, this);
      }
      return func(this, b);
    };
  };
  
  var makeBinaryOpNumberFunction = function(func, selector, ugenSelector) {
    return function(b) {
      if (Array.isArray(b)) {
        return b.map(function(b) {
          return this[selector](b);
        }, this);
      } else if (cc.instanceOfUGen(b)) {
        return cc.createBinaryOpUGen(ugenSelector, this, b);
      }
      return func(this, b);
    };
  };
  var makeBinaryOpArrayFunction = function(selector, ugenSelector) {
    return function(b) {
      var a = this;
      if (Array.isArray(b)) {
        if (a.length === b.length) {
          return a.map(function(a, index) {
            return a[selector](b[index]);
          });
        } else if (a.length > b.length) {
          return a.map(function(a, index) {
            return a[selector](b[index % b.length]);
          });
        } else {
          return b.map(function(b, index) {
            return a[index % a.length][selector](b);
          });
        }
      } else if (cc.instanceOfUGen(b)) {
        return a.map(function(a) {
          return cc.createBinaryOpUGen(ugenSelector, a, b);
        });
      }
      return a.map(function(a) {
        return a[selector](b);
      });
    };
  };
  var makeBinaryOpUGenFunction = function(selector) {
    return function(b) {
      var a = this;
      if (Array.isArray(b)) {
        return b.map(function(b) {
          return cc.createBinaryOpUGen(selector, a, b);
        });
      }
      return cc.createBinaryOpUGen(selector, a, b);
    };
  };
  
  var setupBinaryOperator = function(selector, func, ugenSelector) {
    ugenSelector = ugenSelector || selector;
    [cc.Object, Boolean, Date, Function, String].forEach(function(Klass) {
      fn.definePrototypeProperty(
        Klass, selector, makeBinaryOpFunction(func, selector)
      );
    });
    fn.definePrototypeProperty(
      Number, selector, makeBinaryOpNumberFunction(func, selector, ugenSelector)
    );
    fn.definePrototypeProperty(
      Array, selector, makeBinaryOpArrayFunction(selector, ugenSelector)
    );
    fn.definePrototypeProperty(
      cc.UGen, selector, makeBinaryOpUGenFunction(ugenSelector)
    );
  };

  
  setupUnaryOperator("__plus__", function() {
    return +this;
  }, "+");
  setupUnaryOperator("__minus__", function() {
    return -this;
  }, "-");
  
  setupBinaryOperator("__add__", function(a, b) {
    return a + b;
  }, "+");
  
  setupBinaryOperator("__sub__", function(a, b) {
    return a - b;
  }, "-");
  
  setupBinaryOperator("__mul__", function(a, b) {
    return a * b;
  }, "*");
  fn.definePrototypeProperty(String, "__mul__", function(b) {
    if (typeof b === "number") {
      var result = new Array(Math.max(0, b));
      for (var i = 0; i < b; i++) {
        result[i] = this;
      }
      return result.join("");
    } else if (Array.isArray(b)) {
      return b.map(function(b) {
        return this.__mul__(b);
      }, this);
    }
    return this * b;
  });
  fn.definePrototypeProperty(Function, "__mul__", function(b) {
    if (typeof b === "function") {
      var f = this, g = b;
      return function() {
        return f.call(null, g.apply(null, arguments));
      };
    }
    if (Array.isArray(b)) {
      return b.map(function() {
        return NaN;
      });
    }
    return this * b;
  });

  
  setupBinaryOperator("__div__", function(a, b) {
    return a / b;
  }, "/");
  fn.definePrototypeProperty(String, "__div__", function(b) {
    if (typeof b === "number") {
      return utils.clump(this.split(""), Math.ceil(this.length/b)).map(function(items) {
        return items.join("");
      });
    } else if (Array.isArray(b)) {
      return b.map(function(b) {
        return this.__div__(b);
      }, this);
    }
    return this / b;
  });
  
  setupBinaryOperator("__mod__", function(a, b) {
    return a % b;
  }, "%");
  fn.definePrototypeProperty(String, "__mod__", function(b) {
    if (typeof b === "number") {
      return utils.clump(this.split(""), b|0).map(function(items) {
        return items.join("");
      });
    } else if (Array.isArray(b)) {
      return b.map(function(b) {
        return this.__mod__(b);
      }, this);
    }
    return this % b;
  });
  
  
  setup("__and__",function(b) {
    return cc.createTaskWaitLogic("and", [this].concat(b));
  });
  fn.definePrototypeProperty(Array, "__and__", function(b) {
    return cc.createTaskWaitLogic("and", this.concat(b));
  });
  
  setup("__or__", function(b) {
    return cc.createTaskWaitLogic("or", [this].concat(b));
  });
  fn.definePrototypeProperty(Array, "__or__", function(b) {
    return cc.createTaskWaitLogic("or", this.concat(b));
  });
  
  
  setup("to_i", function() {
    return this|0;
  });
  fn.definePrototypeProperty(Array, "to_i", function() {
    return this.map(function(x) {
      return x.to_i();
    });
  });
  
  setup("to_f", function() {
    return +this;
  });
  fn.definePrototypeProperty(Array, "to_f", function() {
    return this.map(function(x) {
      return x.to_f();
    });
  });
  
  setup("to_s", function() {
    return this.toString();
  });
  fn.definePrototypeProperty(Array, "to_s", function() {
    return this.map(function(x) {
      return x.to_s();
    });
  });
  
  setup("to_a", function() {
    return [this];
  });
  fn.definePrototypeProperty(Array, "to_a", function() {
    return this;
  });
  
  
  fn.definePrototypeProperty(Number, "madd", fn(function(mul, add) {
    return cc.createMulAdd(this, mul, add);
  }).defaults("mul=1,add=0").multiCall().build());
  
  fn.definePrototypeProperty(Array, "madd", fn(function(mul, add) {
    return utils.flop([this, mul, add]).map(function(items) {
      var _in = items[0], mul = items[1], add = items[2];
      return cc.createMulAdd(_in, mul, add);
    });
  }).defaults("mul=1,add=0").multiCall().build());
  
  
  module.exports = {};

});
define('cc/client/number', function(require, exports, module) {

  var cc = require("./cc");
  var fn = require("./fn");
  
  var setup = function(selector, func) {
    fn.definePrototypeProperty(Number, selector, func);
    fn.definePrototypeProperty(Array, selector, function() {
      return this.map(function(x) { return x[selector](); });
    });
    fn.definePrototypeProperty(cc.UGen, selector, function() {
      return cc.createUnaryOpUGen(selector, this);
    });
  };
  
  setup("neg", function() {
    return -this;
  });
  setup("not", function() {
    return this === 0 ? 1 : 0;
  });
  setup("abs", function() {
    return Math.abs(this);
  });
  setup("ceil", function() {
    return Math.ceil(this);
  });
  setup("floor", function() {
    return Math.floor(this);
  });
  setup("frac", function() {
    if (this < 0) {
      return 1 + (this - (this|0));
    }
    return this - (this|0);
  });
  setup("sign", function() {
    if (this === 0) {
      return 0;
    } else if (this > 0) {
      return 1;
    }
    return -1;
  });
  setup("squared", function() {
    return this * this;
  });
  setup("cubed", function() {
    return this * this * this;
  });
  setup("sqrt", function() {
    return Math.sqrt(Math.abs(this));
  });
  setup("exp", function() {
    return Math.exp(this);
  });
  setup("reciprocal", function() {
    return 1 / this;
  });
  setup("midicps", function() {
    return 440 * Math.pow(2, (this - 69) * 1/12);
  });
  setup("cpsmidi", function() {
    return Math.log(Math.abs(this) * 1/440) * Math.LOG2E * 12 + 69;
  });
  setup("midiratio", function() {
    return Math.pow(2, this * 1/12);
  });
  setup("ratiomidi", function() {
    return Math.log(Math.abs(this)) * Math.LOG2E * 12;
  });
  setup("dbamp", function() {
    return Math.pow(10, this * 0.05);
  });
  setup("ampdb", function() {
    return Math.log(Math.abs(this)) * Math.LOG10E * 20;
  });
  setup("octcps", function() {
    return 440 * Math.pow(2, this - 4.75);
  });
  setup("cpsoct", function() {
    return Math.log(Math.abs(this) * 1/440) * Math.LOG2E + 4.75;
  });
  setup("log", function() {
    return Math.log(Math.abs(this));
  });
  setup("log2", function() {
    return Math.log(Math.abs(this)) * Math.LOG2E;
  });
  setup("log10", function() {
    return Math.log(Math.abs(this)) * Math.LOG10E;
  });
  setup("sin", function() {
    return Math.sin(this);
  });
  setup("cos", function() {
    return Math.cos(this);
  });
  setup("tan", function() {
    return Math.tan(this);
  });
  setup("asin", function() {
    return Math.asin(Math.max(-1, Math.min(this, 1)));
  });
  setup("acos", function() {
    return Math.acos(Math.max(-1, Math.min(this, 1)));
  });
  setup("atan", function() {
    return Math.atan(this);
  });
  setup("sinh", function() {
    return (Math.pow(Math.E, this) - Math.pow(Math.E, -this)) * 0.5;
  });
  setup("cosh", function() {
    return (Math.pow(Math.E, this) + Math.pow(Math.E, -this)) * 0.5;
  });
  setup("tanh", function() {
    return this.sinh() / this.cosh();
  });
  setup("rand", function() {
    return Math.random() * this;
  });
  setup("rand2", function() {
    return (Math.random() * 2 - 1) * this;
  });
  setup("linrand", function() {
    return Math.min(Math.random(), Math.random()) * this;
  });
  setup("bilinrand", function() {
    return (Math.random() - Math.random()) * this;
  });
  setup("sum3rand", function() {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 0.666666667 * this;
  });
  setup("distort", function() {
    return this / (1 + Math.abs(this));
  });
  setup("softclip", function() {
    var absa = Math.abs(this);
    return absa <= 0.5 ? this : (absa - 0.25) / this;
  });
  setup("coin", function() {
    return Math.random() < this;
  });
  
  setup("num", function() {
    return +this;
  });
  setup("tilde", function() {
    return ~this;
  });
  setup("pi", function() {
    return this * Math.PI;
  });
  
  module.exports = {};

});
define('cc/exports/coffeecollider', function(require, exports, module) {

  var cc = require("../cc");
  var extend = require("../common/extend");
  var emitter  = require("../common/emitter");
  var unpack   = require("../common/pack").unpack;
  var commands = {};
  var slice    = [].slice;
  
  var CoffeeCollider = (function() {
    function CoffeeCollider(opts) {
      emitter.mixin(this);
      opts = opts || {};
      this.version = cc.version;
      if (opts.socket) {
        var impl  = cc.createCoffeeColliderSocketImpl(this, opts);
        this.impl = impl;
        this.socket = {
          open: function() {
            impl.sendToClient([ "/socket/open" ]);
          },
          close: function() {
            impl.sendToClient([ "/socket/close" ]);
          },
          send: function(msg) {
            impl.sendToClient([ "/socket/sendToServer", msg ]);
          }
        };
        cc.opmode = "socket";
      } else if (opts.iframe) {
        this.impl = cc.createCoffeeColliderIFrameImpl(this, opts);
        cc.opmode = "iframe";
      } else if (opts.nodejs) {
        this.impl = cc.createCoffeeColliderNodeJSImpl(this, opts);
        cc.opmode = "nodejs";
      } else {
        this.impl = cc.createCoffeeColliderWorkerImpl(this, opts);
        cc.opmode = "worker";
      }
      this.sampleRate = this.impl.sampleRate;
      this.channels   = this.impl.channels;
    }
    
    CoffeeCollider.prototype.play = function() {
      this.impl.play();
      return this;
    };
    CoffeeCollider.prototype.pause = function() {
      this.impl.pause();
      return this;
    };
    CoffeeCollider.prototype.reset = function() {
      this.impl.reset();
      return this;
    };
    CoffeeCollider.prototype.execute = function() {
      this.impl.execute.apply(this.impl, arguments);
      return this;
    };
    CoffeeCollider.prototype.getStream = function() {
      return this.impl.getStream();
    };
    CoffeeCollider.prototype.importScripts = function() {
      this.impl.importScripts(slice.call(arguments));
      return this;
    };
    CoffeeCollider.prototype.getWebAudioComponents = function() {
      return this.impl.getWebAudioComponents();
    };
    
    return CoffeeCollider;
  })();

  var CoffeeColliderImpl = (function() {
    function CoffeeColliderImpl(exports, opts) {
      var that = this;
      this.exports  = exports;
      this.compiler = cc.createCompiler("coffee");
      
      this.isPlaying = false;
      this.execId = 0;
      this.execCallbacks = {};

      this.sampleRate = 44100;
      this.channels   = 2;
      this.api = cc.createAudioAPI(this, opts);
      this.sampleRate = this.api.sampleRate;
      this.channels   = this.api.channels;
      this.strm  = new Int16Array(this.strmLength * this.channels);
      this.clear = new Int16Array(this.strmLength * this.channels);
      this.strmList = new Array(8);
      this.strmListReadIndex  = 0;
      this.strmListWriteIndex = 0;
      this.speaker = opts.speaker !== false;
      this.api.init();

      var syncItems = new Uint8Array(12);
      if (typeof window !== "undefined" && opts.mouse !== false) {
        var f32_syncItems = new Float32Array(syncItems.buffer);
        window.addEventListener("mousemove", function(e) {
          f32_syncItems[1] = e.pageX / window.innerWidth;
          f32_syncItems[2] = e.pageY / window.innerHeight;
          that.syncItemsChanged = true;
        }, false);
        window.addEventListener("mousedown", function() {
          syncItems[3] = 1;
          that.syncItemsChanged = true;
        }, false);
        window.addEventListener("mouseup", function() {
          syncItems[3] = 0;
          that.syncItemsChanged = true;
        }, false);
      }
      this.syncItems = syncItems;
    }
    
    CoffeeColliderImpl.prototype.play = function() {
      if (!this.isPlaying) {
        this.isPlaying = true;
        if (this.api) {
          var strm = this.strm;
          for (var i = 0, imax = strm.length; i < imax; ++i) {
            strm[i] = 0;
          }
          this.strmList.splice(0);
          this.strmListReadIndex  = 0;
          this.strmListWriteIndex = 0;
          this.api.play();
        }
        this.sendToClient(["/play"]);
        this.exports.emit("play");
      }
    };
    CoffeeColliderImpl.prototype.pause = function() {
      if (this.isPlaying) {
        this.isPlaying = false;
        if (this.api) {
          this.api.pause();
        }
        this.sendToClient(["/pause"]);
        this.exports.emit("pause");
      }
    };
    CoffeeColliderImpl.prototype.reset = function() {
      this.execId = 0;
      this.execCallbacks = {};
      var strm = this.strm;
      for (var i = 0, imax = strm.length; i < imax; ++i) {
        strm[i] = 0;
      }
      this.strmList.splice(0);
      this.strmListReadIndex  = 0;
      this.strmListWriteIndex = 0;
      this.sendToClient(["/reset"]);
      this.exports.emit("reset");
    };
    CoffeeColliderImpl.prototype.process = function() {
      var strm = this.strmList[this.strmListReadIndex];
      if (strm) {
        this.strmListReadIndex = (this.strmListReadIndex + 1) & 7;
        this.strm.set(strm);
      }
      if (this.syncItemsChanged) {
        this.sendToClient(this.syncItems);
        this.syncItemsChanged = false;
      }
    };
    CoffeeColliderImpl.prototype.execute = function(code) {
      var append, callback;
      var i = 1;
      if (typeof arguments[i] === "boolean") {
        append = arguments[i++];
      } else {
        append = false;
      }
      if (typeof arguments[i] === "function") {
        callback = arguments[i++];
      }
      if (typeof code === "string") {
        code = this.compiler.compile(code.trim());
        if (callback) {
          this.execCallbacks[this.execId] = callback;
        }
        this.sendToClient([
          "/execute", this.execId, code, append, this.compiler.data, !!callback
        ]);
        this.execId += 1;
      }
    };
    CoffeeColliderImpl.prototype.getStream = function() {
      var f32 = new Float32Array(this.strm);
      for (var i = f32.length; i--; ) {
        f32[i] *= 0.000030517578125;
      }
      var strmLength = this.strmLength;
      return {
        getChannelData: function(channel) {
          if (channel === 0) {
            return new Float32Array(f32.buffer, 0, strmLength);
          } else if (channel === 1) {
            return new Float32Array(f32.buffer, strmLength * 4);
          }
        }
      };
    };
    CoffeeColliderImpl.prototype.importScripts = function(list) {
      this.sendToClient(["/importScripts", list]);
    };
    CoffeeColliderImpl.prototype.sendToClient = function(msg) {
      if (this.client) {
        this.client.postMessage(msg);
      }
    };
    CoffeeColliderImpl.prototype.recvFromClient = function(msg) {
      if (msg instanceof Int16Array) {
        this.strmList[this.strmListWriteIndex] = msg;
        this.strmListWriteIndex = (this.strmListWriteIndex + 1) & 7;
      } else {
        var func = commands[msg[0]];
        if (func) {
          func.call(this, msg);
        } else {
          throw new Error("Unknown command: " + msg[0]);
        }
      }
    };
    CoffeeColliderImpl.prototype.readAudioFile = function(path, callback) {
      var api = this.api;
      if (this.api) {
        if (typeof path !== "string") {
          throw new TypeError("readAudioFile: first argument must be a String.");
        }
        if (typeof callback !== "function") {
          throw new TypeError("readAudioFile: second argument must be a Function.");
        }
        if (!api.decodeAudioFile) {
          callback("Audio decoding not supported", null);
          return;
        }
        var xhr = cc.createXMLHttpRequest();
        xhr.open("GET", path);
        xhr.responseType = "arraybuffer";
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status === 200 && xhr.response) {
              api.decodeAudioFile(xhr.response, function(err, buffer) {
                callback(err, buffer);
              });
            } else {
              callback("error", null);
            }
          }
        };
        xhr.send();
      }
    };
    CoffeeColliderImpl.prototype.getWebAudioComponents = function() {
      if (this.api && this.api.type === "Web Audio API") {
        return [ this.api.context, this.api.jsNode ];
      }
      return [];
    };
    
    return CoffeeColliderImpl;
  })();
  
  
  var CoffeeColliderWorkerImpl = (function() {
    function CoffeeColliderWorkerImpl(exports, opts) {
      this.strmLength = 1024;
      this.bufLength  = 64;
      CoffeeColliderImpl.call(this, exports, opts);
      var that = this;
      this.client = cc.createWebWorker(cc.coffeeColliderPath);
      this.client.onmessage = function(e) {
        that.recvFromClient(e.data);
      };
    }
    extend(CoffeeColliderWorkerImpl, CoffeeColliderImpl);
    
    return CoffeeColliderWorkerImpl;
  })();
  
  
  var CoffeeColliderIFrameImpl = (function() {
    function CoffeeColliderIFrameImpl(exports, opts) {
      this.strmLength = 2048;
      this.bufLength  = 128;
      CoffeeColliderImpl.call(this, exports, opts);
      var that = this;
      var iframe = this.iframe = cc.createHTMLIFrameElement();
      // TODO: want to remove 'allow-same-origin'
      iframe.sandbox = "allow-scripts allow-same-origin";
      iframe.srcdoc = "<script src='" + cc.coffeeColliderPath + "#iframe'></script>";
      var channel = cc.createMessageChannel();
      iframe.onload = function() {
        iframe.contentWindow.postMessage(null, [channel.port2], "*");
      };
      channel.port1.onmessage = function(e) {
        that.recvFromClient(e.data);
      };
      this.client = channel.port1;
    }
    extend(CoffeeColliderIFrameImpl, CoffeeColliderImpl);
    
    return CoffeeColliderIFrameImpl;
  })();
  
  
  var CoffeeColliderNodeJSImpl = (function() {
    function CoffeeColliderNodeJSImpl(exports, opts) {
      this.strmLength = 4096;
      this.bufLength  = 64;
      CoffeeColliderImpl.call(this, exports, opts);
      this.api = null;
    }
    extend(CoffeeColliderNodeJSImpl, CoffeeColliderImpl);
    
    return CoffeeColliderNodeJSImpl;
  })();
  
  
  var CoffeeColliderSocketImpl = (function() {
    function CoffeeColliderSocketImpl(exports, opts) {
      this.strmLength = 4096;
      this.bufLength  = 128;
      CoffeeColliderImpl.call(this, exports, opts);
      var that = this;
      var iframe = this.iframe = cc.createHTMLIFrameElement();
      iframe.sandbox = "allow-scripts";
      iframe.srcdoc = "<script src='" + cc.coffeeColliderPath + "#socket'></script>";
      var channel = cc.createMessageChannel();
      iframe.onload = function() {
        iframe.contentWindow.postMessage(opts.socket, [channel.port2], "*");
      };
      channel.port1.onmessage = function(e) {
        that.recvFromClient(e.data);
      };
      this.client = channel.port1;
    }
    extend(CoffeeColliderSocketImpl, CoffeeColliderImpl);
    
    return CoffeeColliderSocketImpl;
  })();

    
  commands["/connected"] = function(msg) {
    var globalIds = msg[3];
    if (globalIds) {
      globalIds.forEach(function(key) {
        cc.global[key] = true;
      });
    }
    this.sendToClient([
      "/init", this.sampleRate, this.channels
    ]);
    this.exports.emit("connected");
  };
  commands["/executed"] = function(msg) {
    var execId = msg[1];
    var result = msg[2];
    var callback = this.execCallbacks[execId];
    if (callback) {
      if (result !== undefined) {
        result = unpack(result);
      }
      callback(result);
      delete this.execCallbacks[execId];
    }
  };
  commands["/buffer/request"] = function(msg) {
    var that = this;
    var requestId = msg[2];
    this.readAudioFile(msg[1], function(err, buffer) {
      if (!err) {
        that.sendToClient(["/buffer/response", buffer, requestId]);
      }
    });
  };
  commands["/socket/sendToIF"] = function(msg) {
    this.exports.emit("message", msg[1]);
  };
  require("../common/console").bindConsoleApply(commands);
  
  var use = function() {
    require("../common/browser").use();
    require("../common/audioapi").use();
    require("./compiler/compiler").use();
    
    cc.createCoffeeCollider = function(opts) {
      return new CoffeeCollider(opts);
    };
    cc.createCoffeeColliderImpl = function(exports, opts) {
      return new CoffeeColliderImpl(exports, opts);
    };
    cc.createCoffeeColliderWorkerImpl = function(exports, opts) {
      return new CoffeeColliderWorkerImpl(exports, opts);
    };
    cc.createCoffeeColliderIFrameImpl = function(exports, opts) {
      return new CoffeeColliderIFrameImpl(exports, opts);
    };
    cc.createCoffeeColliderNodeJSImpl = function(exports, opts) {
      return new CoffeeColliderNodeJSImpl(exports, opts);
    };
    cc.createCoffeeColliderSocketImpl = function(exports, opts) {
      return new CoffeeColliderSocketImpl(exports, opts);
    };
  };
  
  module.exports = {
    CoffeeCollider: CoffeeCollider,
    use:use
  };

});
define('cc/common/audioapi', function(require, exports, module) {
  
  var cc = require("../cc");
  
  var AudioAPI;
  
  if (typeof document !== "undefined") {
    var AudioContext = global.AudioContext || global.webkitAudioContext;
    if (AudioContext) {
      AudioAPI = (function() {
        function WebAudioAPI(sys, opts) {
          this.sys = sys;
          this.context = opts.AudioContext || new AudioContext();
          this.sampleRate = this.context.sampleRate;
          this.channels   = 2;
          this.type = "Web Audio API";
          this.delegate = !!opts.AudioContext;
        }
        WebAudioAPI.prototype.init = function() {
          var sys = this.sys;
          var onaudioprocess;
          var strm = sys.strm;
          var strmLength = sys.strmLength;
          if (this.sys.speaker) {
            if (this.sys.sampleRate === this.sampleRate) {
              onaudioprocess = function(e) {
                var outs = e.outputBuffer;
                var outL = outs.getChannelData(0);
                var outR = outs.getChannelData(1);
                var i = strmLength, j = strmLength << 1;
                sys.process();
                while (j--, i--) {
                  outL[i] = strm[i] * 0.000030517578125;
                  outR[i] = strm[j] * 0.000030517578125;
                }
              };
            }
          } else {
            onaudioprocess = function() {
              sys.process();
            };
          }
          this.bufSrc = this.context.createBufferSource();
          if (this.context.createScriptProcessor) {
            this.jsNode = this.context.createScriptProcessor(strmLength, 2, this.channels);
          } else {
            this.jsNode = this.context.createJavaScriptNode(strmLength, 2, this.channels);
          }
          this.jsNode.onaudioprocess = onaudioprocess;
        };
        WebAudioAPI.prototype.play = function() {
          if (!this.bufSrc) {
            return; // TODO: throw an error
          }
          if (this.bufSrc.noteOn) {
            this.bufSrc.noteOn(0);
            this.bufSrc.connect(this.jsNode);
          }
          if (!this.delegate) {
            this.jsNode.connect(this.context.destination);
          }
        };
        WebAudioAPI.prototype.pause = function() {
          if (!this.bufSrc) {
            return; // TODO: throw an error
          }
          this.bufSrc.disconnect();
          if (!this.delegate) {
            this.jsNode.disconnect();
          }
        };
        WebAudioAPI.prototype.decodeAudioFile = function(buffer, callback) {
          buffer = this.context.createBuffer(buffer, false);
          var bufLength   = buffer.length;
          var numChannels = buffer.numberOfChannels;
          var numSamples  = bufLength * numChannels;
          var samples = new Float32Array(numSamples);
          var i, j, k = 0;
          var channelData = new Array(numChannels);
          for (j = 0; j < numChannels; ++j) {
            channelData[j] = buffer.getChannelData(j);
          }
          for (i = 0; i < bufLength; ++i) {
            for (j = 0; j < numChannels; ++j) {
              samples[k++] = channelData[j][i];
            }
          }
          callback(null, {
            sampleRate : buffer.sampleRate,
            numChannels: buffer.numberOfChannels,
            numFrames  : buffer.length,
            samples    : samples,
          });
        };
        return WebAudioAPI;
      })();
    } else if (typeof Audio === "function" && typeof new Audio().mozSetup === "function") {
      AudioAPI = (function() {
        /*global URL:true */
        var timer = (function() {
          var source = "var t=0;onmessage=function(e){if(t)t=clearInterval(t),0;if(typeof e.data=='number'&&e.data>0)t=setInterval(function(){postMessage(0);},e.data);};";
          var blob = new Blob([source], {type:"text/javascript"});
          var path = URL.createObjectURL(blob);
          return new Worker(path);
        })();
        /*global URL:false */
        function AudioDataAPI(sys) {
          this.sys = sys;
          this.sampleRate = 44100;
          this.channels   = 2;
          this.type = "Audio Data API";
        }
        AudioDataAPI.prototype.init = function() {
          this.audio = new Audio();
          this.interleaved = new Float32Array(this.sys.strmLength * this.sys.channels);
        };
        AudioDataAPI.prototype.play = function() {
          if (!this.audio) {
            return; // TODO: throw an error
          }
          var sys = this.sys;
          var audio = this.audio;
          var interleaved = this.interleaved;
          var msec = (sys.strmLength / sys.sampleRate) * 1000;
          var written = 0;
          var start = Date.now();
          var inL = new Int16Array(sys.strm.buffer, 0, sys.strmLength);
          var inR = new Int16Array(sys.strm.buffer, sys.strmLength * 2);

          var onaudioprocess = function() {
            if (written - 60 > Date.now() - start) {
              return;
            }
            var i = interleaved.length;
            var j = inL.length;
            sys.process();
            while (j--) {
              interleaved[--i] = inR[j] * 0.000030517578125;
              interleaved[--i] = inL[j] * 0.000030517578125;
            }
            audio.mozWriteAudio(interleaved);
            written += msec;
          };

          audio.mozSetup(sys.channels, sys.sampleRate);
          timer.onmessage = onaudioprocess;
          timer.postMessage(msec * 0.8);
        };
        AudioDataAPI.prototype.pause = function() {
          if (!this.audio) {
            return; // TODO: throw an error
          }
          timer.postMessage(0);
        };
        return AudioDataAPI;
      })();
    }

    if (!AudioAPI) {
      AudioAPI = (function() {
        function FallbackAudioAPI(sys) {
          this.sys = sys;
          this.sampleRate = 44100;
          this.channels   = 2;
          this.type = "Fallback";
        }
        FallbackAudioAPI.prototype.init = function() {
        };
        FallbackAudioAPI.prototype.play = function() {
          if (fallback.play) {
            this.play = fallback.play;
            this.play();
          }
        };
        FallbackAudioAPI.prototype.pause = function() {
          if (fallback.pause) {
            this.pause = fallback.pause;
            this.pause();
          }
        };
        
        var fallback = {};
        window.addEventListener("load", function() {
          var swfSrc  = cc.rootPath + "coffee-collider-fallback.swf";
          var swfName = swfSrc + "?" + Date.now();
          var swfId   = "coffee-collider-fallback";
          var div = document.createElement("div");
          div.style.display = "inline";
          div.width  = 1;
          div.height = 1;
          /*jshint quotmark:single */
          div.innerHTML = '<object id="'+swfId+'" classid="clsid:D27CDB6E-AE6D-11cf-96B8-444553540000" width="1" height="1"><param name="movie" value="'+swfName+'"/><param name="bgcolor" value="#FFFFFF"/><param name="quality" value="high"/><param name="allowScriptAccess" value="always"/></object>';
          /*jshint quotmark:double */
          document.body.appendChild(div);
          
          window.coffeecollider_flashfallback_init = function() {
            var swf = document.getElementById(swfId);
            var timerId = 0;
            fallback.play = function() {
              if (timerId === 0) {
                var sys = this.sys;
                var msec = (sys.strmLength / sys.sampleRate) * 1000;
                var written = 0;
                var start = Date.now();
                var out   = new Array(sys.strmLength * sys.channels);
                var len   = out.length;
                
                var onaudioprocess = function() {
                  if (written > Date.now() - start) {
                    return;
                  }
                  sys.process();
                  var _in = sys.strm;
                  for (var i = 0; i < len; ++i) {
                    out[i] = String.fromCharCode( ((_in[i] + 32768)>>1) + 16384 );
                  }
                  swf.writeAudio(out.join(""));
                  written += msec;
                };

                timerId = setInterval(onaudioprocess, msec * 0.8);
                swf.play();
              }
            };
            fallback.pause = function() {
              if (timerId !== 0) {
                swf.pause();
                clearInterval(timerId);
                timerId = 0;
              }
            };
          };
        });
        return FallbackAudioAPI;
      })();
    }
  } else if (typeof global.GLOBAL !== "undefined") {
    AudioAPI = (function() {
      var Readable = global.require("stream").Readable;
      var Speaker  = global.require("speaker");
      if (!Readable) {
        Readable = global.require("readable-stream/readable");
      }
      function NodeAudioAPI(sys) {
        this.sys = sys;
        this.sampleRate = 44100;
        this.channels   = 2;
        this.node = null;
        this.isPlaying = false;
      }
      NodeAudioAPI.prototype.init = function() {
      };
      NodeAudioAPI.prototype.play = function() {
        var sys = this.sys;
        this.isPlaying = true;
        this.node = new Readable();
        this.node._read = function(n) {
          var strm = sys._strm;
          var strmLength = sys.strmLength;
          var buf  = new Buffer(n);
          var x, i, j, k = 0;
          n = (n >> 2) / sys.strmLength;
          x = strm;
          while (n--) {
            sys._process();
            for (i = 0, j = strmLength; i < strmLength; ++i, ++j) {
              buf.writeInt16LE(strm[i], k);
              k += 2;
              buf.writeInt16LE(strm[j], k);
              k += 2;
            }
          }
          this.push(buf);
        };
        this.node.pipe(new Speaker({sampleRate:this.sampleRate}));
      };
      NodeAudioAPI.prototype.pause = function() {
        if (this.node) {
          process.nextTick(this.node.emit.bind(this.node, "end"));
        }
        this.node = null;
        this.isPlaying = false;
      };
      return NodeAudioAPI;
    })();
  }
  
  
  module.exports = {
    use: function() {
      cc.createAudioAPI = function(sys, opts) {
        return new AudioAPI(sys, opts);
      };
    }
  };

});
define('cc/exports/compiler/compiler', function(require, exports, module) {

  var cc = require("../../cc");
  
  var use = function() {
    require("./coffee").use();
    
    cc.createCompiler = function(lang) {
      if (lang === "coffee") {
        return cc.createCoffeeCompiler();
      }
    };
  };
  
  module.exports = {
    use:use
  };

});
define('cc/exports/compiler/coffee', function(require, exports, module) {
  
  var cc = require("../../cc");
  
  var CoffeeScript = (function() {
    if (global.CoffeeScript) {
      return global.CoffeeScript;
    }
    return global.require("coffee-script");
  })();

  var timevalue = require("../../common/timevalue").calc;

  // CoffeeScript tags
  // IDENTIFIER
  // NUMBER
  // STRING
  // REGEX
  // BOOL
  // NULL
  // UNDEFINED
  // COMPOUND_ASSIGN -=, +=, div=, *=, %=, ||=, &&=, ?=, <<=, >>=, >>>=, &=, ^=, |=
  // UNARY           !, ~, new, typeof, delete, do
  // LOGIC           &&, ||, &, |, ^
  // SHIFT           <<, >>, >>>
  // COMPARE         ==, !=, <, >, <=, >=
  // MATH            *, div, %, 
  // RELATION        in, of, instanceof
  // =
  // +
  // -
  // ..
  // ...
  // ++
  // --
  // (
  // )
  // [
  // ]
  // {
  // }
  // ?
  // ::
  // @
  // THIS
  // SUPER
  // INDENT
  // OUTDENT
  // RETURN
  // TERMINATOR

  var TAG   = 0;
  var VALUE = 1;
  var _     = {}; // empty location
  
  var dumpTokens = function(tokens) {
    var indent = 0;
    console.log(tokens.map(function(t) {
      switch (t[0]) {
      case "OUTDENT": case "CALL_END": case "PARAM_END": case "}": case "]": case ")":
        indent -= 1;
        break;
      }
      var x = tab(indent) + t[0] + "\t" + t[1];
      switch (t[0]) {
      case "(": case "[": case "{": case "PARAM_START": case "CALL_START": case "INDENT":
        indent += 1;
        break;
      }
      return x;
    }).join("\n"));
  };
  
  var tab = function(n) {
    var t = "";
    while (n--) {
      t += "  ";
    }
    return t;
  };

  var findOperandHead = function(tokens, index) {
    var bracket = 0;
    var indent  = 0;
    while (0 < index) {
      var token = tokens[index - 1];
      if (!token || token[TAG] !== ".") {
        token = tokens[index];
        switch (token[TAG]) {
        case "PARAM_START":
          return index;
        case "CALL_START":
          bracket -= 1;
          break;
        case "(": case "[": case "{":
          bracket -= 1;
          /* falls through */
        case "IDENTIFIER":
        case "NUMBER": case "STRING": case "BOOL":
        case "REGEX": case "NULL": case "UNDEFINED":
          if (indent === 0 && bracket === 0) {
            token = tokens[index - 1];
            if (token) {
              if (token[TAG] === "UNARY") {
                return index - 1;
              }
              if (token[VALUE] === "+" || token[VALUE] === "-") {
                token = tokens[index - 2];
                if (!token) {
                  return index - 1;
                }
                switch (token[TAG]) {
                case "INDENT": case "TERMINATOR": case "CALL_START":
                case "COMPOUND_ASSIGN": case "UNARY": case "LOGIC":
                case "SHIFT": case "COMPARE": case "=": case "..": case "...":
                case "[": case "(": case "{": case ",": case "?":
                  return index - 1;
                }
              }
            }
            return index;
          }
          break;
        case "}": case "]": case ")": case "PARAM_END": case "CALL_END":
          bracket += 1;
          break;
        case "INDENT":
          indent += 1;
          break;
        case "OUTDENT":
          indent -= 1;
          break;
        }
      }
      index -= 1;
    }
    return 0;
  };

  var findOperandTail = function(tokens, index) {
    var bracket  = 0;
    var indent   = 0;
    var inParams = false;
    while (index < tokens.length) {
      var token = tokens[index];
      if (inParams) {
        inParams = token[TAG] !== "PARAM_END";
        index += 1;
        continue;
      }
      switch (token[TAG]) {
      case "}": case "]": case ")": case "CALL_END":
        bracket -= 1;
        break;
      case "OUTDENT":
        indent -= 1;
        break;
      case "PARAM_START":
        inParams = true;
        index += 1;
        continue;
      }
      token = tokens[index + 1];
      if (!token || token[TAG] !== ".") {
        token = tokens[index];
        switch (token[TAG]) {
        case "TERMINATOR":
          if (indent === 0) {
            return index - 1;
          }
          break;
        case "IDENTIFIER":
          token = tokens[index + 1];
          if (token && token[TAG] === "CALL_START") {
            bracket += 1;
            break;
          }
          if (indent === 0 && bracket === 0) {
            return index;
          }
          break;
        case "NUMBER": case "STRING": case "BOOL":
        case "REGEX": case "NULL": case "UNDEFINED":
          if (indent === 0 && bracket === 0) {
            return index;
          }
          break;
        case "(": case "[": case "{":
          bracket += 1;
          break;
        case "}": case "]": case ")": case "CALL_END":
          if (indent === 0 && bracket === 0) {
            return index;
          }
          break;
        case "INDENT":
          indent += 1;
          break;
        case "OUTDENT":
          if (indent === 0 && bracket === 0) {
            return index;
          }
          break;
        }
      }
      index += 1;
    }
    return tokens.length - 1;
  };

  var replaceTimeValue = function(tokens) {
    var i = tokens.length - 1;
    while (0 <= i) {
      var token = tokens[i];
      if (token[TAG] === "STRING" && token[VALUE].charAt(0) === "\"") {
        var time = timevalue(token[VALUE].substr(1, token[VALUE].length-2));
        if (typeof time === "number") {
          token[TAG] = "NUMBER";
          token[VALUE] = time.toString();
        }
      }
      i -= 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };
  
  var replacePrecedence = function(tokens) {
    var i = tokens.length - 1;
    while (0 <= i) {
      var token = tokens[i];
      if (token[TAG] === "MATH") {
        var a = findOperandHead(tokens, i);
        var b = findOperandTail(tokens, i) + 1;
        tokens.splice(b, 0, [")", ")" , _]);
        tokens.splice(a, 0, ["(", "(" , _]);
      }
      i -= 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };

  var replaceUnaryOpTable = {
    "+": "__plus__", "-": "__minus__"
  };

  var replaceUnaryOp = function(tokens) {
    var i = tokens.length - 1;
    while (0 <= i) {
      var token = tokens[i];
      if (replaceUnaryOpTable.hasOwnProperty(token[VALUE])) {
        var selector = replaceUnaryOpTable[token[VALUE]];
        token = tokens[i - 1] || { 0:"TERMINATOR" };
        switch (token[TAG]) {
        case "INDENT": case "TERMINATOR": case "CALL_START":
        case "COMPOUND_ASSIGN": case "UNARY": case "LOGIC":
        case "SHIFT": case "COMPARE": case "=": case "..": case "...":
        case "[": case "(": case "{": case ",": case "?": case "+": case "-": case ":":
          var a = findOperandTail(tokens, i);
          tokens.splice(a+1, 0, ["."         , "."     , _]);
          tokens.splice(a+2, 0, ["IDENTIFIER", selector, _]);
          tokens.splice(a+3, 0, ["CALL_START", "("     , _]);
          tokens.splice(a+4, 0, ["CALL_END"  , ")"     , _]);
          tokens.splice(i, 1);
        }
      }
      i -= 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };
  
  var replaceBinaryOpTable = {
    "+": "__add__", "-": "__sub__", "*": "__mul__", "/": "__div__", "%": "__mod__"
  };
  
  var replaceBinaryOp = function(tokens) {
    var i = 0;
    var replaceable = false;
    while (i < tokens.length) {
      var token = tokens[i];
      if (replaceable) {
        if (replaceBinaryOpTable.hasOwnProperty(token[VALUE])) {
          var selector = replaceBinaryOpTable[token[VALUE]];
          var b = findOperandTail(tokens, i) + 1;
          tokens.splice(i++, 1, ["."         , "."     , _]);
          tokens.splice(i++, 0, ["IDENTIFIER", selector, _]);
          tokens.splice(i  , 0, ["CALL_START", "("     , _]);
          tokens.splice(b+2, 0, ["CALL_END"  , ")"     , _]);
          replaceable = false;
          continue;
        }
      }
      switch (token[TAG]) {
      case "INDENT": case "TERMINATOR": case "CALL_START":
      case "COMPOUND_ASSIGN": case "UNARY": case "LOGIC":
      case "SHIFT": case "COMPARE": case "=": case "..": case "...":
      case "[": case "(": case "{": case ",": case "?":
        replaceable = false;
        break;
      default:
        replaceable = true;
      }
      i += 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };

  var replaceLogicOpTable = {
    "&&": "__and__", "||": "__or__"
  };
  
  var replaceLogicOp = function(tokens) {
    var i = 1;
    var replaceable = false;
    var bracket = 0;
    while (i < tokens.length) {
      var token = tokens[i];
      if (replaceable && bracket === 1) {
        if (replaceLogicOpTable.hasOwnProperty(token[VALUE])) {
          var selector = replaceLogicOpTable[token[VALUE]];
          var b = findOperandTail(tokens, i) + 1;
          tokens.splice(i++, 1, ["."          , "."     , _]);
          tokens.splice(i++, 0, ["IDENTIFIER" , selector, _]);
          tokens.splice(i++, 0, ["!CALL_START", "("     , _]);
          tokens.splice(b+2, 0, ["!CALL_END"  , ")"     , _]);
          continue;
        }
      }
      switch (token[TAG]) {
      case "IDENTIFIER":
        if (tokens[i-1][TAG] === "@" && token[VALUE] === "wait") {
          replaceable = true;
          bracket = 0;
        }
        break;
      case "INDENT": case "TERMINATOR":
        if (replaceable && bracket === 0) {
          replaceable = false;
        }
        break;
      case "{": case "PARAM_START": case "CALL_START":
        if (replaceable) {
          bracket += 1;
        }
        break;
      case "CALL_END": case "PARAM_END": case "}":
        if (replaceable) {
          bracket -= 1;
        }
        break;
      }
      i += 1;
    }
    tokens.forEach(function(items) {
      if (items[TAG].charAt(0) === "!") {
        items[TAG] = items[TAG].substr(1);
      }
    });
    // dumpTokens(tokens);
    return tokens;
  };
  
  var replaceCompoundAssignTable = {
    "+=": "__add__",
    "-=": "__sub__",
    "*=": "__mul__",
    "/=": "__div__",
    "%=": "__mod__",
  };
  
  var replaceCompoundAssign = function(tokens) {
    var i = tokens.length - 1;
    while (0 <= i) {
      var token = tokens[i];
      if (replaceCompoundAssignTable.hasOwnProperty(token[VALUE])) {
        var selector = replaceCompoundAssignTable[token[VALUE]];
        var a = findOperandHead(tokens, i);
        var b = findOperandTail(tokens, i) + 1;
        tokens[i] = ["=", "=", _];
        tokens.splice(i+1, 0, ["."         , "."     , _]);
        tokens.splice(i+2, 0, ["IDENTIFIER", selector, _]);
        tokens.splice(i+3, 0, ["CALL_START", "("     , _]);
        tokens.splice(b+3, 0, ["CALL_END"  , ")"     , _]);
        for (var j = a; j < i; j++) {
          tokens.splice(i+1, 0, tokens[j]);
        }
      }
      i -= 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };
  
  var replaceSynthDef = (function() {
    var getParams = function(tokens, index) {
      var begin = -1, end = -1;
      for (var i = index + 1; i < tokens.length; ++i) {
        if (tokens[i][TAG] === "PARAM_START") {
          begin = i;
        } else if (tokens[i][TAG] === "PARAM_END") {
          end = i;
          break;
        }
      }
      var replace = "";
      if (begin !== -1) {
        replace = tokens.slice(begin+1, end).map(function(t) {
          return t[VALUE];
        }).join("").replace(/"/g, "'");
      }
      replace = "\"" + replace + "\"";
      return { begin:begin, end:end, replace:replace };
    };
    return function(tokens) {
      var i = tokens.length - 1;
      while (0 <= i) {
        if (tokens[i - 2] && tokens[i - 2][VALUE] === "Synth") {
          if (tokens[i - 1][TAG] === ".") {
            var token = tokens[i];
            if (token[VALUE] === "def") {
              token = tokens[i + 1];
              if (token[TAG] === "CALL_START") {
                var a = findOperandTail(tokens, i + 2);
                var params = getParams(tokens, i + 1);
                tokens.splice(++a, 0, [","     , ","           , _]);
                tokens.splice(++a, 0, ["STRING", params.replace, _]);
              }
            }
          }
        }
        i -= 1;
      }
      // dumpTokens(tokens);
      return tokens;
    };
  })();

  var replaceGlobal = function(tokens) {
    var i = tokens.length - 2;
    while (i >= 0) {
      var token = tokens[i];
      if (token[TAG] === "IDENTIFIER") {
        if ((i === 0 || tokens[i-1][TAG] !== ".") && cc.global.hasOwnProperty(token[VALUE])) {
          if (token[VALUE] !== "CoffeeCollider" && token[VALUE] !== "SocketSynthServer") {
            tokens.splice(i  , 1, ["IDENTIFIER", "cc"        , _]);
            tokens.splice(i+1, 0, ["."         , "."         , _]);
            tokens.splice(i+2, 0, ["IDENTIFIER", token[VALUE], _]);
          }
        }
        if (token[VALUE].charAt(0) === "$") {
          var name = token[VALUE];
          if (!/\d/.test(name.charAt(1))) {
            name = name.substr(1);
          }
          if (name !== "") {
            token = tokens[i - 1];
            if (!token || token[TAG] !== ".") {
              tokens.splice(i  , 1, ["IDENTIFIER", "global", _]);
              tokens.splice(i+1, 0, ["."         , "."     , _]);
              tokens.splice(i+2, 0, ["IDENTIFIER", name    , _]);
            }
          }
        }
      }
      i -= 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };
  
  var cleanupParenthesis = function(tokens) {
    var i = 0;
    var bracket = 0;
    while (i < tokens.length) {
      var token = tokens[i];
      if (token[TAG] === "(") {
        token = tokens[i + 1];
        if (token && token[TAG] === "(") {
          bracket = 2;
          for (var j = i + 2; j < tokens.length; j++) {
            token = tokens[j][TAG];
            if (token === "(") {
              bracket += 1;
            } if (token === ")") {
              bracket -= 1;
              if (bracket === 0) {
                if (tokens[j - 1][TAG] === ")") {
                  tokens.splice(j, 1);
                  tokens.splice(i, 1);
                  i -= 1;
                }
                break;
              }
            }
          }
        }
      }
      i += 1;
    }
    // dumpTokens(tokens);
    return tokens;
  };

  var insertReturn = function(tokens) {
    tokens.splice(0, 0, ["("          , "("     , _]);
    tokens.splice(1, 0, ["PARAM_START", "("     , _]);
    tokens.splice(2, 0, ["IDENTIFIER" , "global", _]);
    tokens.splice(3, 0, ["PARAM_END"  , ")"     , _]);
    tokens.splice(4, 0, ["->"         , "->"    , _]);
    tokens.splice(5, 0, ["INDENT"     , 2       , _]);
    var i = tokens.length - 1;
    tokens.splice(i++, 0, ["OUTDENT"   , 2       , _]);
    tokens.splice(i++, 0, [")"         , ")"     , _]);
    tokens.splice(i++, 0, ["."         , "."     , _]);
    tokens.splice(i++, 0, ["IDENTIFIER", "call"  , _]);
    tokens.splice(i++, 0, ["CALL_START", "("     , _]);
    tokens.splice(i++, 0, ["IDENTIFIER", "_gltc_", _]);
    tokens.splice(i++, 0, [","         , ","     , _]);
    tokens.splice(i++, 0, ["THIS"      , "this"  , _]);
    tokens.splice(i++, 0, ["."         , "."     , _]);
    tokens.splice(i++, 0, ["IDENTIFIER", "self"  , _]);
    tokens.splice(i++, 0, ["LOGIC"     , "||"    , _]);
    tokens.splice(i++, 0, ["IDENTIFIER", "global", _]);
    tokens.splice(i++, 0, ["CALL_END"  , ")"     , _]);
    // dumpTokens(tokens);
    return tokens;
  };
  
  var Compiler = (function() {
    function Compiler() {
    }
    Compiler.prototype.tokens = function(code) {
      var data = [];
      var tokens = CoffeeScript.tokens(code);
      if (tokens.length) {
        tokens.forEach(function(token) {
          if (token[TAG] === "HERECOMMENT") {
            data.push(token[VALUE].trim());
          }
        });
        tokens = replaceTimeValue(tokens);
        tokens = replaceUnaryOp(tokens);
        tokens = replacePrecedence(tokens);
        tokens = replaceBinaryOp(tokens);
        tokens = replaceLogicOp(tokens);
        tokens = replaceCompoundAssign(tokens);
        tokens = replaceSynthDef(tokens);
        tokens = replaceGlobal(tokens);
        tokens = cleanupParenthesis(tokens);
        tokens = insertReturn(tokens);
      }
      this.code = code;
      this.data = data;
      return tokens;
    };
    Compiler.prototype.compile = function(code) {
      var tokens = this.tokens(code);
      return CoffeeScript.nodes(tokens).compile({bare:true}).trim();
    };
    Compiler.prototype.toString = function(tokens) {
      var indent = 0;
      if (typeof tokens === "string") {
        tokens = this.tokens(tokens);
      }
      return tokens.map(function(token) {
        switch (token[TAG]) {
        case "TERMINATOR":
          return "\n" + tab(indent);
        case "INDENT":
          indent += token[VALUE]|0;
          return "\n" + tab(indent);
        case "OUTDENT":
          indent -= token[VALUE]|0;
          return "\n" + tab(indent);
        case "RETURN":
          return "return ";
        case "UNARY":
          if (token[VALUE].length > 1) {
            return token[VALUE] + " ";
          }
          return token[VALUE];
        case "{":
          return "{";
        case ",": case "RELATION":
          return token[VALUE] + " ";
        case "=":
          return " = ";
        case "COMPOUND_ASSIGN": case "COMPARE": case "MATH": case "+": case "-":
          return " " + token[VALUE] + " ";
        default:
          return token[VALUE];
        }
      }).join("").trim();
    };
    return Compiler;
  })();

  var use = function() {
    cc.createCoffeeCompiler = function() {
      return new Compiler();
    };
  };
  
  module.exports = {
    Compiler  : Compiler,
    dumpTokens: dumpTokens,
    findOperandHead : findOperandHead,
    findOperandTail : findOperandTail,
    replaceTimeValue     : replaceTimeValue,
    replacePrecedence    : replacePrecedence,
    replaceUnaryOp       : replaceUnaryOp,
    replaceBinaryOp      : replaceBinaryOp,
    replaceLogicOp       : replaceLogicOp,
    replaceCompoundAssign: replaceCompoundAssign,
    replaceSynthDef      : replaceSynthDef,
    replaceGlobal        : replaceGlobal,
    cleanupParenthesis   : cleanupParenthesis,
    insertReturn         : insertReturn,
    use:use,
  };

});
define('cc/common/timevalue', function(require, exports, module) {

  var cc = require("../cc");
  
  var calc = function(str) {
    var result = null;
    var freq;
    if (str.charAt(0) === "~") {
      freq = true;
      str  = str.substr(1);
    }
    do {
      result = hz(str);
      if (result !== null) {
        break;
      }
      result = time(str);
      if (result !== null) {
        break;
      }
      result = hhmmss(str);
      if (result !== null) {
        break;
      }
      result = samples(str);
      if (result !== null) {
        break;
      }
      result = note(str);
      if (result !== null) {
        break;
      }
      result = beat(str);
      if (result !== null) {
        break;
      }
      result = ticks(str);
    } while (false);
    
    if (result !== null) {
      if (!freq) {
        return result;
      }
      if (result !== 0) {
        return 1 / result;
      }
    }
    return str;
  };
  
  var hz = function(str) {
    var m = /^(\d+(?:\.\d+)?)hz$/i.exec(str);
    if (m) {
      return +m[1] === 0 ? 0 : 1 / +m[1];
    }
    return null;
  };
  var time = function(str) {
    var m = /^(\d+(?:\.\d+)?)(min|sec|m)s?$/i.exec(str);
    if (m) {
      switch (m[2]) {
      case "min": return +(m[1]||0) * 60;
      case "sec": return +(m[1]||0);
      case "m"  : return +(m[1]||0) / 1000;
      }
    }
    return null;
  };

  var hhmmss = function(str) {
    var m = /^(?:([1-9][0-9]*):)?([0-5]?[0-9]):([0-5][0-9])(?:\.(\d{1,3}))?$/.exec(str);
    if (m) {
      var x = 0;
      x += (m[1]|0) * 3600;
      x += (m[2]|0) * 60;
      x += (m[3]|0);
      x += (((m[4]||"")+"00").substr(0, 3)|0) / 1000;
      return x;
    }
    return null;
  };

  var samples = function(str) {
    var m = /^(\d+)samples(?:\/(\d+)hz)?$/i.exec(str);
    if (m) {
      return m[1] / ((m[2]|0) || cc.sampleRate);
    }
    return null;
  };

  var calcNote = function(bpm, len, dot) {
    var x = (60 / bpm) * (4 / len);
    x *= [1, 1.5, 1.75, 1.875][dot] || 1;
    return x;
  };
  var note = function(str) {
    var m = /^bpm([1-9]\d+(?:\.\d+)?)\s*l([1-9]\d*)(\.*)$/i.exec(str);
    if (m) {
      return calcNote(+m[1], +m[2], m[3].length);
    }
    return null;
  };

  var calcBeat = function(bpm, measure, beat, ticks) {
    var x = (measure * 4 + beat) * 480 + ticks;
    return (60 / bpm) * (x / 480);
  };
  var beat = function(str) {
    var m = /^bpm([1-9]\d+(?:\.\d+)?)\s*(\d+)\.(\d+).(\d{1,3})$/i.exec(str);
    if (m) {
      return calcBeat(+m[1], +m[2], +m[3], +m[4]);
    }
    return null;
  };

  var calcTicks = function(bpm, ticks) {
    return 60 / bpm * ticks / 480;
  };
  var ticks = function(str) {
    var m = /^bpm([1-9]\d+(?:\.\d+)?)\s*(\d+)ticks$/i.exec(str);
    if (m) {
      return calcTicks(+m[1], +m[2]);
    }
    return null;
  };
  
  module.exports = {
    hz     : hz,
    time   : time,
    hhmmss : hhmmss,
    samples: samples,
    note   : note,
    beat   : beat,
    ticks  : ticks,
    calcNote : calcNote,
    calcBeat : calcBeat,
    calcTicks: calcTicks,
    calc: calc,
  };

});
define('cc/server/server', function(require, exports, module) {

  var cc = require("./cc");
  var extend = require("../common/extend");
  var pack  = require("../common/pack").pack;
  var emitter = require("../common/emitter");
  var commands = {};
  
  var SynthServer = (function() {
    function SynthServer() {
      this.sampleRate = 0;
      this.channels   = 0;
      this.strmLength = 0;
      this.bufLength  = 0;
      this.instanceManager = cc.createInstanceManager();
      this.strm = null;
      this.timer = cc.createTimer();
      this.processed = 0;
      this.processStart    = 0;
      this.processInterval = 0;
      this.initialized = false;
    }
    
    SynthServer.prototype.sendToClient = function() {
      throw "SynthServer#sendToClient: should be overridden";
    };
    SynthServer.prototype.recvFromClient = function(msg, userId) {
      userId = userId|0;
      if (msg instanceof Uint8Array) {
        this.instanceManager.doBinayCommand(userId, msg);
      } else {
        var func = commands[msg[0]];
        if (func) {
          func.call(this, msg, userId);
        } else {
          throw new Error("Unknown command: " + msg[0]);
        }
      }
    };
    SynthServer.prototype.connect = function() {
      throw "SynthServer#connect: should be overridden";
    };
    SynthServer.prototype.init = function(msg) {
      if (!this.initialized) {
        this.initialized = true;
        if (msg) {
          this.sampleRate = msg[1]|0;
          this.channels   = msg[2]|0;
        }
        this.strm  = new Int16Array(this.strmLength * this.channels);
        this.instanceManager.init(this);
        this.instanceManager.append(0);
      }
    };
    SynthServer.prototype.play = function(msg, userId) {
      userId = userId|0;
      this.instanceManager.play(userId);
      if (!this.timer.isRunning()) {
        this.processStart = Date.now();
        this.processDone  = 0;
        this.processInterval = (this.strmLength / this.sampleRate) * 1000;
        this.timer.start(this.process.bind(this), 10);
      }
    };
    SynthServer.prototype.pause = function(msg, userId) {
      userId = userId|0;
      this.instanceManager.pause(userId);
      if (this.timer.isRunning()) {
        if (!this.instanceManager.isRunning()) {
          this.timer.stop();
        }
      }
    };
    SynthServer.prototype.reset = function(msg, userId) {
      userId = userId|0;
      this.instanceManager.reset(userId);
    };
    SynthServer.prototype.pushToTimeline = function(msg, userId) {
      userId = userId|0;
      var timeline = msg[1];
      this.instanceManager.pushToTimeline(userId, timeline);
    };
    SynthServer.prototype.process = function() {
      throw "SynthServer#process: should be overridden";
    };
    
    return SynthServer;
  })();
  
  
  var WorkerSynthServer = (function() {
    function WorkerSynthServer() {
      SynthServer.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 1024;
      this.bufLength  = 64;
      this.offset = 0;
    }
    extend(WorkerSynthServer, SynthServer);
    
    WorkerSynthServer.prototype.sendToClient = function(msg) {
      postMessage(msg);
    };
    WorkerSynthServer.prototype.connect = function() {
      this.sendToClient([
        "/connected", this.sampleRate, this.channels
      ]);
    };
    WorkerSynthServer.prototype.process = function() {
      if (this.processDone - 60 > Date.now() - this.processStart) {
        return;
      }
      var strm = this.strm;
      var instanceManager = this.instanceManager;
      var strmLength = this.strmLength;
      var bufLength  = this.bufLength;
      var busOutL = instanceManager.busOutL;
      var busOutR = instanceManager.busOutR;
      var client = cc.client;
      var offset = 0;
      for (var i = 0, imax = strmLength / bufLength; i < imax; ++i) {
        client.process();
        instanceManager.process(bufLength);
        var j = bufLength, k = strmLength + bufLength;
        while (k--, j--) {
          strm[j + offset] = Math.max(-32768, Math.min(busOutL[j] * 32768, 32767));
          strm[k + offset] = Math.max(-32768, Math.min(busOutR[j] * 32768, 32767));
        }
        offset += bufLength;
      }
      this.sendToClient(strm);
      this.processDone += this.processInterval;
    };
    
    return WorkerSynthServer;
  })();
  
  
  var IFrameSynthServer = (function() {
    function IFrameSynthServer() {
      WorkerSynthServer.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 2048;
      this.bufLength  = 128;
    }
    extend(IFrameSynthServer, WorkerSynthServer);
    
    IFrameSynthServer.prototype.sendToClient = function(msg) {
      postMessage(msg);
    };
    IFrameSynthServer.prototype.connect = function() {
      this.sendToClient([
        "/connected", this.sampleRate, this.channels
      ]);
    };
    IFrameSynthServer.prototype.process = function() {
      if (this.processDone - 60 > Date.now() - this.processStart) {
        return;
      }
      var strm = this.strm;
      var instanceManager = this.instanceManager;
      var strmLength = this.strmLength;
      var bufLength  = this.bufLength;
      var busOutL = instanceManager.busOutL;
      var busOutR = instanceManager.busOutR;
      var offset = 0;
      for (var i = 0, imax = strmLength / bufLength; i < imax; ++i) {
        instanceManager.process(bufLength);
        var j = bufLength, k = strmLength + bufLength;
        while (k--, j--) {
          strm[j + offset] = Math.max(-32768, Math.min(busOutL[j] * 32768, 32767));
          strm[k + offset] = Math.max(-32768, Math.min(busOutR[j] * 32768, 32767));
        }
        offset += bufLength;
      }
      this.sendToClient(strm);
      this.sendToClient(["/process"]);
      this.processDone += this.processInterval;
    };
    
    return IFrameSynthServer;
  })();
  
  
  var NodeJSSynthServer = (function() {
    function NodeJSSynthServer() {
      SynthServer.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 4096;
      this.bufLength  = 64;
      require("../common/audioapi").use();
    }
    extend(NodeJSSynthServer, SynthServer);

    NodeJSSynthServer.prototype.init = function() {
      if (!this.initialized) {
        SynthServer.prototype.init.call(this);
        this.api = cc.createAudioAPI(this);
      }
    };
    NodeJSSynthServer.prototype.connect = function() {
      this.sendToClient([
        "/connected", this.sampleRate, this.channels
      ]);
    };
    NodeJSSynthServer.prototype.play = function(msg, userId) {
      userId = userId|0;
      this.instanceManager.play(userId);
      if (this.api) {
        this._strm = new Int16Array(this.strmLength * this.channels);
        this.strmList = new Array(8);
        this.strmListReadIndex  = 0;
        this.strmListWriteIndex = 0;
        if (!this.api.isPlaying) {
          this.api.play();
        }
      }
      if (!this.timer.isRunning()) {
        this.processStart = Date.now();
        this.processDone  = 0;
        this.processInterval = (this.strmLength / this.sampleRate) * 1000;
        this.timer.start(this.process.bind(this), 10);
      }
    };
    NodeJSSynthServer.prototype.pause = function(msg, userId) {
      userId = userId|0;
      this.instanceManager.pause(userId);
      if (this.api) {
        if (this.api.isPlaying) {
          if (!this.instanceManager.isRunning()) {
            this.api.pause();
          }
        }
      }
      if (this.timer.isRunning()) {
        if (!this.instanceManager.isRunning()) {
          this.timer.stop();
        }
      }
    };
    NodeJSSynthServer.prototype.process = function() {
      if (this.processDone - 60 > Date.now() - this.processStart) {
        return;
      }
      var strm = this.strm;
      var instanceManager = this.instanceManager;
      var strmLength = this.strmLength;
      var bufLength  = this.bufLength;
      var busOutL = instanceManager.busOutL;
      var busOutR = instanceManager.busOutR;
      var client = cc.client;
      var offset = 0;
      for (var i = 0, imax = strmLength / bufLength; i < imax; ++i) {
        client.process();
        instanceManager.process(bufLength);
        var j = bufLength, k = strmLength + bufLength;
        while (k--, j--) {
          strm[j + offset] = Math.max(-32768, Math.min(busOutL[j] * 32768, 32767));
          strm[k + offset] = Math.max(-32768, Math.min(busOutR[j] * 32768, 32767));
        }
        offset += bufLength;
      }
      this.sendToClient(strm);
      this.processDone += this.processInterval;
      
      if (this.api) {
        this.strmList[this.strmListWriteIndex] = new Int16Array(strm);
        this.strmListWriteIndex = (this.strmListWriteIndex + 1) & 7;
      }
    };
    NodeJSSynthServer.prototype._process = function() {
      var strm = this.strmList[this.strmListReadIndex];
      if (strm) {
        this.strmListReadIndex = (this.strmListReadIndex + 1) & 7;
        this._strm.set(strm);
      }
    };
    
    return NodeJSSynthServer;
  })();
  
  
  var SocketSynthServer = (function() {
    var WebSocketServer;
    if (global.require) {
      WebSocketServer = global.require("ws").Server;
    }
    function SocketSynthServer() {
      NodeJSSynthServer.call(this);
      this.sampleRate = 44100;
      this.channels   = 2;
      this.strmLength = 4096;
      this.bufLength  = 128;
      this.list = [];
      this.map  = {};
      this.exports = null; // bind after
    }
    extend(SocketSynthServer, NodeJSSynthServer);
    
    SocketSynthServer.prototype._init = function(opts) {
      var that = this;
      var _userId = 0;
      var exports = this.exports;
      if (typeof opts.speaker !== "undefined") {
        if (opts.speaker) {
          this.api = cc.createAudioAPI(this);
        }
        delete opts.speaker;
      }
      this.socket = new WebSocketServer(opts);
      this.socket.on("connection", function(ws) {
        var userId = _userId++;
        that.list.push(ws);
        that.map[userId] = ws;
        that.instanceManager.append(userId);
        ws.on("message", function(msg) {
          // receive a message from the client
          if (typeof msg !== "string") {
            msg = new Uint8Array(msg);
          } else {
            msg = JSON.parse(msg);
          }
          that.recvFromClient(msg, userId);
        });
        ws.on("close", function() {
          if (that.map[userId]) {
            that.pause([], userId);
            that.instanceManager.remove(userId);
            that.list.splice(that.list.indexOf(ws), 1);
            delete that.map[userId];
          }
          exports.emit("close", userId);
        });
        ws.on("error", function(e) {
          exports.emit("error", userId, e);
        });
        that.sendToClient([
          "/connected", that.sampleRate, that.channels
        ], userId);
        exports.emit("open", userId);
      });
      this.init();
    };
    SocketSynthServer.prototype.connect = function() {
    };
    SocketSynthServer.prototype.sendToClient = function(msg, userId) {
      if (msg instanceof Int16Array) {
        this.list.forEach(function(ws) {
          if (ws.readyState === 1) {
            ws.send(msg.buffer, {binary:true, mask:false});
          }
        });
      } else {
        msg = JSON.stringify(msg);
        if (userId === undefined) {
          this.list.forEach(function(ws) {
            if (ws.readyState === 1) {
              ws.send(msg);
            }
          });
        } else {
          var ws = this.map[userId];
          if (ws && ws.readyState === 1) {
            ws.send(msg);
          }
        }
      }
    };
    SocketSynthServer.prototype.process = function() {
      if (this.processDone - 60 > Date.now() - this.processStart) {
        return;
      }
      var strm = this.strm;
      var instanceManager = this.instanceManager;
      var strmLength = this.strmLength;
      var bufLength  = this.bufLength;
      var busOutL = instanceManager.busOutL;
      var busOutR = instanceManager.busOutR;
      var offset = 0;
      for (var i = 0, imax = strmLength / bufLength; i < imax; ++i) {
        instanceManager.process(bufLength);
        var j = bufLength, k = strmLength + bufLength;
        while (k--, j--) {
          strm[j + offset] = Math.max(-32768, Math.min(busOutL[j] * 32768, 32767));
          strm[k + offset] = Math.max(-32768, Math.min(busOutR[j] * 32768, 32767));
        }
        offset += bufLength;
      }
      this.sendToClient(strm);
      this.sendToClient(["/process"]);
      this.processDone += this.processInterval;

      if (this.api) {
        this.strmList[this.strmListWriteIndex] = new Int16Array(strm);
        this.strmListWriteIndex = (this.strmListWriteIndex + 1) & 7;
      }
    };
    
    return SocketSynthServer;
  })();

  var SocketSynthServerExports = (function() {
    var instance = null;
    function SocketSynthServerExports(server, opts) {
      if (instance) {
        console.warn("CoffeeColliderSocketServer has been created already.");
        return instance;
      }
      emitter.mixin(this);
      this.server = server;
      this.server.exports = this;
      this.server._init(opts||{});
      instance = this;
    }
    SocketSynthServerExports.prototype.send = function(msg, userId) {
      this.server.sendToClient([
        "/socket/sendToIF", msg
      ], userId);
      return this;
    };
    return SocketSynthServerExports;
  })();
  
  
  commands["/init"] = function(msg, userId) {
    this.init(msg, userId);
  };
  commands["/play"] = function(msg, userId) {
    this.play(msg, userId);
  };
  commands["/pause"] = function(msg, userId) {
    this.pause(msg, userId);
  };
  commands["/reset"] = function(msg, userId) {
    this.reset(msg, userId);
  };
  commands["/processed"] = function(msg, userId) {
    this.pushToTimeline(msg, userId);
  };
  commands["/socket/sendToServer"] = function(msg, userId) {
    // receive a message from the client-interface via the client
    if (this.exports) {
      msg = msg[1];
      msg.userId = userId;
      this.exports.emit("message", msg);
    }
  };
  
  
  module.exports = {
    use: function() {
      require("../common/timer").use();
      require("./instance").use();
      require("./rate").use();
      require("./unit/unit").use();
      
      cc.createSynthServer = function() {
        require("./unit/installer").install();
        switch (cc.opmode) {
        case "worker":
          return cc.createWorkerSynthServer();
        case "iframe":
          return cc.createIFrameSynthServer();
        case "nodejs":
          return cc.createNodeJSSynthServer();
        case "socket":
          return cc.createSocketSynthServer();
        }
        throw new Error("A SynthServer is not defined for: " + cc.opmode);
      };
      cc.createWorkerSynthServer = function() {
        var server = new WorkerSynthServer();
        cc.opmode = "worker";
        return server;
      };
      cc.createIFrameSynthServer = function() {
        var server = new IFrameSynthServer();
        global.onmessage = function(e) {
          server.recvFromClient(e.data, 0);
        };
        cc.opmode = "iframe";
        return server;
      };
      cc.createNodeJSSynthServer = function() {
        var server = new NodeJSSynthServer();
        cc.opmode = "nodejs";
        return server;
      };
      cc.createSocketSynthServer = function() {
        var server = new SocketSynthServer();
        server.exports = {
          createServer: function(opts) {
            return new SocketSynthServerExports(server, opts);
          }
        };
        cc.opmode = "socket";
        return server;
      };
      
      if (typeof global.console === "undefined") {
        global.console = (function() {
          var console = {};
          ["log", "debug", "info", "warn", "error"].forEach(function(method) {
            console[method] = function() {
              if (cc.server) {
                var args = Array.prototype.slice.call(arguments).map(function(x) {
                  return pack(x);
                });
                cc.server.sendToClient(["/console/" + method, args]);
              }
            };
          });
          return console;
        })();
      }
    }
  };

});
define('cc/server/cc', function(require, exports, module) {

  var _cc = require("../cc");

  if (!_cc.UGen) {
    _cc.UGen = Object;
  }
  
  module.exports = _cc;

});
define('cc/server/instance', function(require, exports, module) {

  var cc = require("./cc");
  var node = require("./node");
  var commands = require("./commands");
  
  var InstanceManager = (function() {
    function InstanceManager() {
      this.map  = {};
      this.list = [];
      this.server = null;
      this.process = process0;
    }

    InstanceManager.prototype.init = function(server) {
      if (this.server) {
        return;
      }
      var busLength  = server.bufLength * 16 + 128;
      var bufLength  = server.bufLength;
      var bufLength4 = server.bufLength << 2;
      this.server    = server;
      this.busClear  = new Float32Array(busLength);
      this.map       = {};
      this.list      = [];
      this.busOut    = new Float32Array(busLength);
      this.busOutLen = server.bufLength << 1;
      this.busOutL  = new Float32Array(this.busOut.buffer, 0         , bufLength);
      this.busOutR  = new Float32Array(this.busOut.buffer, bufLength4, bufLength);
    };
    InstanceManager.prototype.append = function(userId) {
      if (!this.map[userId]) {
        var instance = new Instance(this, userId);
        this.map[userId] = instance;
        this.list.push(instance);
        if (this.list.length === 1) {
          this.process = process1;
        } else {
          this.process = processN;
        }
      }
      return this.map[userId];
    };
    InstanceManager.prototype.remove = function(userId) {
      var instance = this.map[userId];
      if (instance) {
        this.list.splice(this.list.indexOf(instance), 1);
        delete this.map[userId];
        if (this.list.length === 1) {
          this.process = process1;
        } else if (this.list.length === 0) {
          this.process = process0;
        }
      }
    };
    InstanceManager.prototype.play = function(userId) {
      var instance = this.map[userId];
      if (instance) {
        instance.play();
      }
    };
    InstanceManager.prototype.pause = function(userId) {
      var instance = this.map[userId];
      if (instance) {
        instance.pause();
      }
    };
    InstanceManager.prototype.reset = function(userId) {
      var instance = this.map[userId];
      if (instance) {
        instance.reset();
      }
    };
    InstanceManager.prototype.isRunning = function() {
      return this.list.some(function(instance) {
        return instance.rootNode.running;
      });
    };
    InstanceManager.prototype.pushToTimeline = function(userId, timeline) {
      var instance = this.map[userId];
      if (instance) {
        instance.timeline = instance.timeline.concat(timeline);
      }
    };
    InstanceManager.prototype.doBinayCommand = function(userId, binary) {
      var instance = this.map[userId];
      if (instance) {
        instance.doBinayCommand(binary);
      }
    };
    
    var process0 = function() {
      this.busOut.set(this.busClear);
    };
    var process1 = function(bufLength, index) {
      this.list[0].process(bufLength, index);
      this.busOut.set(this.list[0].bus);
    };
    var processN = function(bufLength, index) {
      var list = this.list;
      var busOut    = this.busOut;
      var busOutLen = this.busOutLen;
      var instance;
      busOut.set(this.busClear);
      for (var i = 0, imax = list.length; i < imax; ++i) {
        instance = list[i];
        instance.process(bufLength, index);
        var inBus = instance.bus;
        var inAmp = instance.busAmp;
        for (var j = busOutLen; j--; ) {
          busOut[j] += inBus[j] * inAmp;
        }
      }
    };
    
    return InstanceManager;
  })();
  
  
  var Instance = (function() {
    function Instance(manager, userId) {
      var busLength = manager.server.bufLength * 16 + 128;
      this.manager = manager;
      this.userId  = userId|0;
      this.bus     = new Float32Array(busLength);
      this.busClear = manager.busClear;
      
      this.busIndex = 0;
      this.busAmp   = 0.8;
      this.timeline = [];
      this.timelineIndex = 0;
      this.rootNode = new node.Group(0, 0, 0, this);
      this.nodes   = { 0:this.rootNode };
      this.fixNums = {};
      this.defs    = {};
      this.buffers = {};
      this.bufSrc  = {};
      this.syncItems     = new Uint8Array(12);
      this.i16_syncItems = new Int16Array(this.syncItems.buffer);
      this.f32_syncItems = new Float32Array(this.syncItems.buffer);
    }

    Instance.prototype.play = function() {
      this.rootNode.running = true;
      this.bus.set(this.busClear);
    };
    Instance.prototype.pause = function() {
      this.rootNode.running = false;
      this.bus.set(this.busClear);
      this.timeline = [];
    };
    Instance.prototype.reset = function() {
      if (this.manager.busClear) {
        this.bus.set(this.manager.busClear);
      }
      this.timeline = [];
      this.rootNode = new node.Group(0, 0, 0, this);
      this.nodes   = { 0:this.rootNode };
      this.fixNums = {};
      this.defs    = {};
      this.buffers = {};
      this.bufSrc  = {};
    };
    Instance.prototype.doBinayCommand = function(binary) {
      var func  = commands[(binary[1] << 8) + binary[0]];
      if (func) {
        func.call(this, binary);
      }
    };
    Instance.prototype.getFixNum = function(value) {
      var fixNums = this.fixNums;
      return fixNums[value] || (fixNums[value] = {
        outputs: [ new Float32Array([value]) ]
      });
    };
    Instance.prototype.process = function(bufLength) {
      var timeline = this.timeline;
      var args;
      
      while ((args = timeline.shift())) {
        var func = commands[args[0]];
        if (func) {
          func.call(this, args);
        }
      }
      
      this.bus.set(this.busClear);
      this.rootNode.process(bufLength, this);
    };
    
    return Instance;
  })();
  
  
  module.exports = {
    InstanceManager: InstanceManager,
    
    use: function() {
      cc.createInstanceManager = function() {
        return new InstanceManager();
      };
    }
  };

});
define('cc/server/node', function(require, exports, module) {

  var cc = require("./cc");
  var extend = require("../common/extend");
  
  var Unit = require("./unit/unit").Unit;
  var graphFunc  = {};
  var doneAction = {};
  
  graphFunc[0] = function(node) {
    var prev;
    if (this instanceof Group) {
      if (this.head === null) {
        this.head = this.tail = node;
      } else {
        prev = this.head.prev;
        if (prev) {
          prev.next = node;
        }
        node.next = this.head;
        this.head.prev = node;
        this.head = node;
      }
      node.parent = this;
    }
  };
  graphFunc[1] = function(node) {
    var next;
    if (this instanceof Group) {
      if (this.tail === null) {
        this.head = this.tail = node;
      } else {
        next = this.tail.next;
        if (next) {
          next.prev = node;
        }
        node.prev = this.tail;
        this.tail.next = node;
        this.tail = node;
      }
      node.parent = this;
    }
  };
  graphFunc[2] = function(node) {
    var prev = this.prev;
    this.prev = node;
    node.prev = prev;
    if (prev) {
      prev.next = node;
    }
    node.next = this;
    if (this.parent && this.parent.head === this) {
      this.parent.head = node;
    }
    node.parent = this.parent;
  };
  graphFunc[3] = function(node) {
    var next = this.next;
    this.next = node;
    node.next = next;
    if (next) {
      next.prev = node;
    }
    node.prev = this;
    if (this.parent && this.parent.tail === this) {
      this.parent.tail = node;
    }
    node.parent = this.parent;
  };
  graphFunc[4] = function(node) {
    node.next = this.next;
    node.prev = this.prev;
    node.head = this.head;
    node.tail = this.tail;
    node.parent = this.parent;
    if (this.prev) {
      this.prev.next = node;
    }
    if (this.next) {
      this.next.prev = node;
    }
    if (this.parent && this.parent.head === this) {
      this.parent.head = node;
    }
    if (this.parent && this.parent.tail === this) {
      this.parent.tail = node;
    }
  };
  
  doneAction[0] = function() {
    // do nothing when the UGen is finished
  };
  doneAction[1] = function() {
    // pause the enclosing synth, but do not free it
    this.running = false;
  };
  doneAction[2] = function() {
    // free the enclosing synth
    free.call(this);
  };
  doneAction[3] = function() {
    // free both this synth and the preceding node
    var prev = this.prev;
    if (prev) {
      free.call(prev);
    }
    free.call(this);
  };
  doneAction[4] = function() {
    // free both this synth and the following node
    var next = this.next;
    free.call(this);
    if (next) {
      free.call(next);
    }
  };
  doneAction[5] = function() {
    // free this synth; if the preceding node is a group then do g_freeAll on it, else free it
    var prev = this.prev;
    if (prev instanceof Group) {
      g_freeAll(prev);
    } else {
      free.call(prev);
    }
    free.call(this);
  };
  doneAction[6] = function() {
    // free this synth; if the following node is a group then do g_freeAll on it, else free it
    var next = this.next;
    free.call(this);
    if (next) {
      g_freeAll(next);
    } else {
      free.call(next);
    }
  };
  doneAction[7] = function() {
    // free this synth and all preceding nodes in this group
    var next = this.parent.head;
    if (next) {
      var node = next;
      while (node && node !== this) {
        next = node.next;
        free.call(node);
        node = next;
      }
    }
    free.call(this);
  };
  doneAction[8] = function() {
    // free this synth and all following nodes in this group
    var next = this.next;
    free.call(this);
    if (next) {
      var node = next;
      while (node) {
        next = node.next;
        free.call(node);
        node = next;
      }
    }
  };
  doneAction[9] = function() {
    // free this synth and pause the preceding node
    var prev = this.prev;
    free.call(this);
    if (prev) {
      prev.running = false;
    }
  };
  doneAction[10] = function() {
    // free this synth and pause the following node
    var next = this.next;
    free.call(this);
    if (next) {
      next.running = false;
    }
  };
  doneAction[11] = function() {
    // free this synth and if the preceding node is a group then do g_deepFree on it, else free it
    var prev = this.prev;
    if (prev instanceof Group) {
      g_deepFree(prev);
    } else {
      free.call(prev);
    }
    free.call(this);
  };
  doneAction[12] = function() {
    // free this synth and if the following node is a group then do g_deepFree on it, else free it
    var next = this.next;
    free.call(this);
    if (next) {
      g_deepFree(next);
    } else {
      free.call(next);
    }
  };
  doneAction[13] = function() {
    // free this synth and all other nodes in this group (before and after)
    var next = this.parent.head;
    if (next) {
      var node = next;
      while (node) {
        next = node.next;
        free.call(node);
        node = next;
      }
    }
  };
  doneAction[14] = function() {
    // free the enclosing group and all nodes within it (including this synth)
    g_deepFree(this);
  };
  var free = function() {
    if (this.prev) {
      this.prev.next = this.next;
    }
    if (this.next) {
      this.next.prev = this.prev;
    }
    if (this.parent) {
      if (this.parent.head === this) {
        this.parent.head = this.next;
      }
      if (this.parent.tail === this) {
        this.parent.tail = this.prev;
      }

      var userId;
      if (this.instance) {
        userId = this.instance.userId;
      }
      cc.server.sendToClient([
        "/emit/n_end", this.nodeId
      ], userId);
    }
    this.prev = null;
    this.next = null;
    this.parent = null;
    this.blocking = false;
    if (this.instance) {
      delete this.instance.nodes[this.nodeId];
    }
  };
  var g_freeAll = function(node) {
    var next = node.head;
    free.call(node);
    node = next;
    while (node) {
      next = node.next;
      free.call(node);
      node = next;
    }
  };
  var g_deepFree = function(node) {
    var next = node.head;
    free.call(node);
    node = next;
    while (node) {
      next = node.next;
      free.call(node);
      if (node instanceof Group) {
        g_deepFree(node);
      }
      node = next;
    }
  };
  
  var Node = (function() {
    function Node(nodeId, instance) {
      this.nodeId = nodeId|0;
      this.next   = null;
      this.prev   = null;
      this.parent = null;
      this.running = true;
      this.instance = instance;
    }
    Node.prototype.play = function() {
      this.running = true;
    };
    Node.prototype.pause = function() {
      this.running = false;
    };
    Node.prototype.stop = function() {
      free.call(this);
    };
    Node.prototype.doneAction = function(action, tag) {
      var func = doneAction[action];
      if (func) {
        func.call(this);
        var userId;
        if (this.instance) {
          userId = this.instance.userId;
        }
        cc.server.sendToClient([
          "/emit/n_done", this.nodeId, tag
        ], userId);
      }
    };
    return Node;
  })();

  var Group = (function() {
    function Group(nodeId, target, addAction, instance) {
      Node.call(this, nodeId, instance);
      this.head = null;
      this.tail = null;
      if (target) {
        graphFunc[addAction].call(target, this);
      }
    }
    extend(Group, Node);
    
    Group.prototype.process = function(inNumSamples, instance) {
      if (this.head && this.running) {
        this.head.process(inNumSamples, instance);
      }
      if (this.next) {
        this.next.process(inNumSamples, instance);
      }
    };
    
    return Group;
  })();

  var Synth = (function() {
    function Synth(nodeId, node, addAction, defId, controls, instance) {
      Node.call(this, nodeId, instance);
      if (instance) {
        var specs = instance.defs[defId];
        if (specs) {
          this.build(specs, controls, instance);
        }
      }
      if (node) {
        graphFunc[addAction].call(node, this);
      }
    }
    extend(Synth, Node);
    
    Synth.prototype.build = function(specs, controls, instance) {
      this.specs = specs;

      var fixNumList = specs.consts.map(function(value) {
        return instance.getFixNum(value);
      });
      var unitList = specs.defs.map(function(spec) {
        return new Unit(this, spec);
      }, this);
      this.params   = specs.params;
      this.controls = new Float32Array(this.params.values);
      this.set(controls);
      this.unitList = unitList.filter(function(unit) {
        var inputs  = unit.inputs;
        var inRates = unit.inRates;
        var inSpec  = unit.specs[3];
        var tag     = unit.specs[5];
        for (var i = 0, imax = inputs.length; i < imax; ++i) {
          var i2 = i << 1;
          if (inSpec[i2] === -1) {
            inputs[i]  = fixNumList[inSpec[i2+1]].outputs[0];
            inRates[i] = 0;
          } else {
            inputs[i]  = unitList[inSpec[i2]].outputs[inSpec[i2+1]];
            inRates[i] = unitList[inSpec[i2]].outRates[inSpec[i2+1]];
          }
        }
        unit.init(tag);
        return !!unit.process;
      });
      return this;
    };

    Synth.prototype.set = function(controls) {
      for (var i = 0, imax = controls.length; i < imax; i += 2) {
        var index = controls[i    ];
        var value = controls[i + 1];
        this.controls[index] = value;
      }
    };
    
    Synth.prototype.process = function(inNumSamples, instance) {
      if (this.running && this.unitList) {
        var unitList = this.unitList;
        for (var i = 0, imax = unitList.length; i < imax; ++i) {
          var unit = unitList[i];
          unit.process(unit.rate.bufLength, instance);
        }
      }
      if (this.next) {
        this.next.process(inNumSamples, instance);
      }
    };
    
    return Synth;
  })();
  
  module.exports = {
    Node : Node,
    Group: Group,
    Synth: Synth,
  };

});
define('cc/server/unit/unit', function(require, exports, module) {

  var cc = require("../cc");

  var specs = {};
  
  var Unit = (function() {
    function Unit(parent, specs) {
      this.parent = parent;
      this.specs  = specs;
      this.name         = specs[0];
      this.calcRate     = specs[1];
      this.specialIndex = specs[2];
      this.numOfInputs  = specs[3].length >> 1;
      this.numOfOutputs = specs[4].length;
      this.inputs   = new Array(this.numOfInputs);
      this.inRates  = new Array(this.numOfInputs);
      this.outRates = specs[4];
      this.rate     = cc.getRateInstance(this.calcRate || 1);
      var bufLength = this.rate.bufLength;
      var allOutputs = new Float32Array(bufLength * this.numOfOutputs);
      var outputs    = new Array(this.numOfOutputs);
      for (var i = 0, imax = outputs.length; i < imax; ++i) {
        outputs[i] = new Float32Array(
          allOutputs.buffer,
          bufLength * i * allOutputs.BYTES_PER_ELEMENT,
          bufLength
        );
      }
      this.outputs    = outputs;
      this.allOutputs = allOutputs;
      this.bufLength  = bufLength;
      this.done       = false;
    }
    Unit.prototype.init = function(tag) {
      var ctor = specs[this.name];
      if (typeof ctor === "function") {
        ctor.call(this);
      } else {
        console.warn(this.name + "'s ctor is not found.");
      }
      this.tag = tag;
      return this;
    };
    Unit.prototype.doneAction = function(action) {
      if (!this.done) {
        this.done = true;
        this.parent.doneAction(action, this.tag);
      }
    };
    return Unit;
  })();
  
  
  module.exports = {
    Unit : Unit,
    specs: specs,
    
    use  : function() {
      cc.createUnit = function(parent, specs) {
        return new Unit(parent, specs);
      };
    }
  };

});
define('cc/server/commands', function(require, exports, module) {
  
  var node   = require("./node");
  var buffer = require("./buffer");
  
  var commands = {};
  
  // the 'this.' context is an instance.
  
  commands["/n_run"] = function(msg) {
    var nodeId = msg[1]|0;
    var flag   = !!msg[2];
    var target = this.nodes[nodeId];
    if (target) {
      target.running = flag;
    }
  };
  commands["/n_free"] = function(msg) {
    var nodeId = msg[1]|0;
    var target = this.nodes[nodeId];
    if (target) {
      target.doneAction(2);
    }
  };
  commands["/n_set"] = function(msg) {
    var nodeId = msg[1]|0;
    var controls = msg[2];
    var target = this.nodes[nodeId];
    if (target) {
      target.set(controls);
    }
  };
  commands["/g_new"] = function(msg) {
    var nodeId       = msg[1]|0;
    var addAction    = msg[2]|0;
    var targetNodeId = msg[3]|0;
    var target = this.nodes[targetNodeId];
    if (target) {
      this.nodes[nodeId] = new node.Group(nodeId, target, addAction, this);
    }
  };
  commands["/s_def"] = function(msg) {
    var defId = msg[1]|0;
    var specs = JSON.parse(msg[2]);
    this.defs[defId] = specs;
  };
  commands["/s_new"] = function(msg) {
    var nodeId       = msg[1]|0;
    var addAction    = msg[2]|0;
    var targetNodeId = msg[3]|0;
    var defId        = msg[4]|0;
    var controls     = msg[5];
    var target = this.nodes[targetNodeId];
    if (target) {
      this.nodes[nodeId] = new node.Synth(nodeId, target, addAction, defId, controls, this);
    }
  };
  commands["/b_new"] = function(msg) {
    var bufId = msg[1]|0;
    this.buffers[bufId] = new buffer.AudioBuffer(bufId);
  };
  commands["/b_bind"] = function(msg) {
    var bufId      = msg[1]|0;
    var bufSrcId   = msg[2]|0;
    var startFrame = msg[3]|0;
    var frames     = msg[4]|0;
    var buffer = this.buffers[bufId];
    var bufSrc = this.bufSrc[bufSrcId];
    if (buffer) {
      if (bufSrc) {
        buffer.bindBufferSource(bufSrc, startFrame, frames);
      } else {
        bufSrc = new buffer.BufferSource(bufSrcId);
        bufSrc.pendings.push([buffer, startFrame, frames]);
        this.bufSrc[bufSrcId] = bufSrc;
      }
    }
  };
  
  commands[0] = function(binay) {
    this.syncItems.set(binay);
  };
  commands[1] = function(binary) {
    var bufSrcId = (binary[3] << 8) + binary[2];
    var channels = (binary[7] << 8) + binary[6];
    var sampleRate = (binary[11] << 24) + (binary[10] << 16) + (binary[ 9] << 8) + binary[ 8];
    var frames     = (binary[15] << 24) + (binary[14] << 16) + (binary[13] << 8) + binary[12];
    var samples = new Float32Array(binary.subarray(16).buffer);
    var bufSrc = this.bufSrc[bufSrcId];
    if (!bufSrc) {
      bufSrc = new buffer.BufferSource(bufSrcId);
    }
    bufSrc.set(channels, sampleRate, frames, samples);
    this.bufSrc[bufSrcId] = bufSrc;
  };
  
  module.exports = commands;

});
define('cc/server/buffer', function(require, exports, module) {

  var BufferSource = (function() {
    function BufferSource(bufSrcId) {
      this.bufSrcId   = bufSrcId;
      this.channels   = 0;
      this.sampleRate = 0;
      this.frames     = 0;
      this.samples    = null;
      this.pendings   = [];
    }
    BufferSource.prototype.set = function(channels, sampleRate, frames, samples) {
      this.channels   = channels;
      this.sampleRate = sampleRate;
      this.frames     = frames;
      this.samples    = samples;
      this.pendings.forEach(function(items) {
        var buffer     = items[0];
        var startFrame = items[1];
        var frames  = items[2];
        buffer.bindBufferSource(this, startFrame, frames);
      }, this);
      this.pendings = null;
    };
    return BufferSource;
  })();
  
  var AudioBuffer = (function() {
    function AudioBuffer(bufId) {
      this.bufId      = bufId;
      this.frames     = 0;
      this.channels   = 0;
      this.sampleRate = 0;
      this.samples    = null;
    }
    AudioBuffer.prototype.bindBufferSource = function(bufSrc, startFrame, frames) {
      startFrame = Math.max( 0, Math.min(startFrame|0, bufSrc.frames));
      frames  = Math.max(-1, Math.min(frames |0, bufSrc.frames - startFrame));
      if (startFrame === 0) {
        if (frames === -1) {
          this.samples = bufSrc.samples;
          this.frames  = bufSrc.frames;
        } else {
          this.samples = new Float32Array(bufSrc.samples.buffer, 0, frames);
          this.frames = frames;
        }
      } else {
        if (frames === -1) {
          this.samples = new Float32Array(bufSrc.samples.buffer, startFrame * 4);
          this.frames = bufSrc.frames - startFrame;
        } else {
          this.samples = new Float32Array(bufSrc.samples.buffer, startFrame * 4, frames);
          this.frames = frames;
        }
      }
      this.channels   = bufSrc.channels;
      this.sampleRate = bufSrc.sampleRate;
    };
    return AudioBuffer;
  })();
  
  module.exports = {
    BufferSource: BufferSource,
    AudioBuffer : AudioBuffer
  };

});
define('cc/server/rate', function(require, exports, module) {
  
  var cc = require("./cc");
  
  var Rate = (function() {
    var twopi = 2 * Math.PI;
    function Rate(sampleRate, bufLength) {
      this.sampleRate = sampleRate;
      this.sampleDur  = 1 / sampleRate;
      this.radiansPerSample = twopi / sampleRate;
      this.bufLength   = bufLength;
      this.bufDuration = bufLength / sampleRate;
      this.bufRate = 1 / this.bufDuration;
      this.slopeFactor = 1 / bufLength;
      this.filterLoops  = (bufLength / 3)|0;
      this.filterRemain = (bufLength % 3)|0;
      if (this.filterLoops === 0) {
        this.filterSlope = 0;
      } else {
        this.filterSlope = 1 / this.filterLoops;
      }
    }
    return Rate;
  })();
  
  
  module.exports = {
    use: function() {
      cc.createRate = function(sampleRate, bufLength) {
        return new Rate(sampleRate, bufLength);
      };
      cc.getRateInstance = (function() {
        var rates = {};
        return function(rate) {
          if (!rates[rate]) {
            switch (rate) {
            case 2:
              rates[2] = new Rate(cc.server.sampleRate, cc.server.bufLength);
              break;
            case 1:
              rates[1] = new Rate(cc.server.sampleRate / cc.server.bufLength, 1);
              break;
            }
          }
          return rates[rate];
        };
      })();
    }
  };

});
define('cc/server/unit/installer', function(require, exports, module) {
  
  module.exports = {
    install: function() {
      require("./unit");
      require("./bop");
      require("./bufio");
      require("./delay");
      require("./inout");
      require("./line");
      require("./madd");
      require("./osc");
      require("./pan");
      require("./ui");
      require("./uop");
    }
  };

});
define('cc/server/unit/bop', function(require, exports, module) {

  var unit = require("./unit");
  var ops  = require("../../common/ops");

  var calcFunc = {};
  
  unit.specs.BinaryOpUGen = (function() {
    var AA = 2   * 10 + 2;
    var AK = 2   * 10 + 1;
    var AI = 2   * 10 + 0;
    var KA = 1 * 10 + 2;
    var KK = 1 * 10 + 1;
    var KI = 1 * 10 + 0;
    var IA = 0  * 10 + 2;
    var IK = 0  * 10 + 1;
    var II = 0  * 10 + 0;
    
    var ctor = function() {
      var func = calcFunc[ops.BINARY_OP_UGEN_MAP[this.specialIndex]];
      var process;
      if (func) {
        switch (this.inRates[0] * 10 + this.inRates[1]) {
        case AA: process = func.aa; break;
        case AK: process = func.ak; break;
        case AI: process = func.ai; break;
        case KA: process = func.ka; break;
        case KK: process = func.kk; break;
        case KI: process = func.ki; break;
        case IA: process = func.ia; break;
        case IK: process = func.ik; break;
        case II: process = func.ii; break;
        }
        this.process = process;
        this._a = this.inputs[0][0];
        this._b = this.inputs[1][0];
        if (this.process) {
          this.process(1);
        } else {
          this.outputs[0][0] = func(this.inputs[0][0], this.inputs[1][0]);
        }
      } else {
        console.log("BinaryOpUGen[" + this.specialIndex + "] is not defined.");
      }
    };
    
    return ctor;
  })();
  
  var binary_aa = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var aIn = this.inputs[0], bIn = this.inputs[1];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(aIn[i  ], bIn[i  ]); out[i+1] = func(aIn[i+1], bIn[i+1]);
        out[i+2] = func(aIn[i+2], bIn[i+2]); out[i+3] = func(aIn[i+3], bIn[i+3]);
        out[i+4] = func(aIn[i+4], bIn[i+4]); out[i+5] = func(aIn[i+5], bIn[i+5]);
        out[i+6] = func(aIn[i+6], bIn[i+6]); out[i+7] = func(aIn[i+7], bIn[i+7]);
      }
    };
  };
  var binary_ak = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var aIn = this.inputs[0], b = this._b;
      var nextB  = this.inputs[1][0];
      var b_slope = (nextB - this._b) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(aIn[i  ], b); b += b_slope;
        out[i+1] = func(aIn[i+1], b); b += b_slope;
        out[i+2] = func(aIn[i+2], b); b += b_slope;
        out[i+3] = func(aIn[i+3], b); b += b_slope;
        out[i+4] = func(aIn[i+4], b); b += b_slope;
        out[i+5] = func(aIn[i+5], b); b += b_slope;
        out[i+6] = func(aIn[i+6], b); b += b_slope;
        out[i+7] = func(aIn[i+7], b); b += b_slope;
      }
      this._b = nextB;
    };
  };
  var binary_ai = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var aIn = this.inputs[0], b = this._b;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(aIn[i  ], b);
        out[i+1] = func(aIn[i+1], b);
        out[i+2] = func(aIn[i+2], b);
        out[i+3] = func(aIn[i+3], b);
        out[i+4] = func(aIn[i+4], b);
        out[i+5] = func(aIn[i+5], b);
        out[i+6] = func(aIn[i+6], b);
        out[i+7] = func(aIn[i+7], b);
      }
    };
  };
  var binary_ka = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var a = this._a, bIn = this.inputs[1];
      var nextA  = this.inputs[0][0];
      var a_slope = (nextA - this._a) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(a, bIn[i  ]); a += a_slope;
        out[i+1] = func(a, bIn[i+1]); a += a_slope;
        out[i+2] = func(a, bIn[i+2]); a += a_slope;
        out[i+3] = func(a, bIn[i+3]); a += a_slope;
        out[i+4] = func(a, bIn[i+4]); a += a_slope;
        out[i+5] = func(a, bIn[i+5]); a += a_slope;
        out[i+6] = func(a, bIn[i+6]); a += a_slope;
        out[i+7] = func(a, bIn[i+7]); a += a_slope;
      }
      this._a = nextA;
    };
  };
  var binary_kk = function(func) {
    return function() {
      this.outputs[0][0] = func(this.inputs[0][0], this.inputs[1][0]);
    };
  };
  var binary_ia = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var a = this._a, bIn = this.inputs[1];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(a, bIn[i  ]);
        out[i+1] = func(a, bIn[i+1]);
        out[i+2] = func(a, bIn[i+2]);
        out[i+3] = func(a, bIn[i+3]);
        out[i+4] = func(a, bIn[i+4]);
        out[i+5] = func(a, bIn[i+5]);
        out[i+6] = func(a, bIn[i+6]);
        out[i+7] = func(a, bIn[i+7]);
      }
    };
  };
  
  
  calcFunc["+"] = function(a, b) {
    return a + b;
  };
  calcFunc["+"].aa = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] + bIn[i  ];
      out[i+1] = aIn[i+1] + bIn[i+1];
      out[i+2] = aIn[i+2] + bIn[i+2];
      out[i+3] = aIn[i+3] + bIn[i+3];
      out[i+4] = aIn[i+4] + bIn[i+4];
      out[i+5] = aIn[i+5] + bIn[i+5];
      out[i+6] = aIn[i+6] + bIn[i+6];
      out[i+7] = aIn[i+7] + bIn[i+7];
    }
  };
  calcFunc["+"].ak = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    var nextB  = this.inputs[1][0];
    var b_slope = (nextB - this._b) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] + b; b += b_slope;
      out[i+1] = aIn[i+1] + b; b += b_slope;
      out[i+2] = aIn[i+2] + b; b += b_slope;
      out[i+3] = aIn[i+3] + b; b += b_slope;
      out[i+4] = aIn[i+4] + b; b += b_slope;
      out[i+5] = aIn[i+5] + b; b += b_slope;
      out[i+6] = aIn[i+6] + b; b += b_slope;
      out[i+7] = aIn[i+7] + b; b += b_slope;
    }
    this._b = nextB;
  };
  calcFunc["+"].ai = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] + b;
      out[i+1] = aIn[i+1] + b;
      out[i+2] = aIn[i+2] + b;
      out[i+3] = aIn[i+3] + b;
      out[i+4] = aIn[i+4] + b;
      out[i+5] = aIn[i+5] + b;
      out[i+6] = aIn[i+6] + b;
      out[i+7] = aIn[i+7] + b;
    }
  };
  calcFunc["+"].ka = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    var nextA  = this.inputs[0][0];
    var a_slope = (nextA - this._a) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a + bIn[i  ]; a += a_slope;
      out[i+1] = a + bIn[i+1]; a += a_slope;
      out[i+2] = a + bIn[i+2]; a += a_slope;
      out[i+3] = a + bIn[i+3]; a += a_slope;
      out[i+4] = a + bIn[i+4]; a += a_slope;
      out[i+5] = a + bIn[i+5]; a += a_slope;
      out[i+6] = a + bIn[i+6]; a += a_slope;
      out[i+7] = a + bIn[i+7]; a += a_slope;
    }
    this._a = nextA;
  };
  calcFunc["+"].kk = function() {
    this.outputs[0][0] = this.inputs[0][0] + this.inputs[1][0];
  };
  calcFunc["+"].ia = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a + bIn[i  ];
      out[i+1] = a + bIn[i+1];
      out[i+2] = a + bIn[i+2];
      out[i+3] = a + bIn[i+3];
      out[i+4] = a + bIn[i+4];
      out[i+5] = a + bIn[i+5];
      out[i+6] = a + bIn[i+6];
      out[i+7] = a + bIn[i+7];
    }
  };
  
  calcFunc["-"] = function(a, b) {
    return a - b;
  };
  calcFunc["-"].aa = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] - bIn[i  ];
      out[i+1] = aIn[i+1] - bIn[i+1];
      out[i+2] = aIn[i+2] - bIn[i+2];
      out[i+3] = aIn[i+3] - bIn[i+3];
      out[i+4] = aIn[i+4] - bIn[i+4];
      out[i+5] = aIn[i+5] - bIn[i+5];
      out[i+6] = aIn[i+6] - bIn[i+6];
      out[i+7] = aIn[i+7] - bIn[i+7];
    }
  };
  calcFunc["-"].ak = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    var nextB  = this.inputs[1][0];
    var b_slope = (nextB - this._b) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] - b; b += b_slope;
      out[i+1] = aIn[i+1] - b; b += b_slope;
      out[i+2] = aIn[i+2] - b; b += b_slope;
      out[i+3] = aIn[i+3] - b; b += b_slope;
      out[i+4] = aIn[i+4] - b; b += b_slope;
      out[i+5] = aIn[i+5] - b; b += b_slope;
      out[i+6] = aIn[i+6] - b; b += b_slope;
      out[i+7] = aIn[i+7] - b; b += b_slope;
    }
    this._b = nextB;
  };
  calcFunc["-"].ai = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] - b;
      out[i+1] = aIn[i+1] - b;
      out[i+2] = aIn[i+2] - b;
      out[i+3] = aIn[i+3] - b;
      out[i+4] = aIn[i+4] - b;
      out[i+5] = aIn[i+5] - b;
      out[i+6] = aIn[i+6] - b;
      out[i+7] = aIn[i+7] - b;
    }
  };
  calcFunc["-"].ka = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    var nextA  = this.inputs[0][0];
    var a_slope = (nextA - this._a) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a - bIn[i  ]; a += a_slope;
      out[i+1] = a - bIn[i+1]; a += a_slope;
      out[i+2] = a - bIn[i+2]; a += a_slope;
      out[i+3] = a - bIn[i+3]; a += a_slope;
      out[i+4] = a - bIn[i+4]; a += a_slope;
      out[i+5] = a - bIn[i+5]; a += a_slope;
      out[i+6] = a - bIn[i+6]; a += a_slope;
      out[i+7] = a - bIn[i+7]; a += a_slope;
    }
    this._a = nextA;
  };
  calcFunc["-"].kk = function() {
    this.outputs[0][0] = this.inputs[0][0] - this.inputs[1][0];
  };
  calcFunc["-"].ia = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a - bIn[i  ];
      out[i+1] = a - bIn[i+1];
      out[i+2] = a - bIn[i+2];
      out[i+3] = a - bIn[i+3];
      out[i+4] = a - bIn[i+4];
      out[i+5] = a - bIn[i+5];
      out[i+6] = a - bIn[i+6];
      out[i+7] = a - bIn[i+7];
    }
  };

  calcFunc["*"] = function(a, b) {
    return a * b;
  };
  calcFunc["*"].aa = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] * bIn[i  ];
      out[i+1] = aIn[i+1] * bIn[i+1];
      out[i+2] = aIn[i+2] * bIn[i+2];
      out[i+3] = aIn[i+3] * bIn[i+3];
      out[i+4] = aIn[i+4] * bIn[i+4];
      out[i+5] = aIn[i+5] * bIn[i+5];
      out[i+6] = aIn[i+6] * bIn[i+6];
      out[i+7] = aIn[i+7] * bIn[i+7];
    }
  };
  calcFunc["*"].ak = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    var nextB  = this.inputs[1][0];
    var b_slope = (nextB - this._b) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] * b; b += b_slope;
      out[i+1] = aIn[i+1] * b; b += b_slope;
      out[i+2] = aIn[i+2] * b; b += b_slope;
      out[i+3] = aIn[i+3] * b; b += b_slope;
      out[i+4] = aIn[i+4] * b; b += b_slope;
      out[i+5] = aIn[i+5] * b; b += b_slope;
      out[i+6] = aIn[i+6] * b; b += b_slope;
      out[i+7] = aIn[i+7] * b; b += b_slope;
    }
    this._b = nextB;
  };
  calcFunc["*"].ai = function(inNumSamples) {
    var out = this.outputs[0];
    var aIn = this.inputs[0], b = this._b;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = aIn[i  ] * b;
      out[i+1] = aIn[i+1] * b;
      out[i+2] = aIn[i+2] * b;
      out[i+3] = aIn[i+3] * b;
      out[i+4] = aIn[i+4] * b;
      out[i+5] = aIn[i+5] * b;
      out[i+6] = aIn[i+6] * b;
      out[i+7] = aIn[i+7] * b;
    }
  };
  calcFunc["*"].ka = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    var nextA  = this.inputs[0][0];
    var a_slope = (nextA - this._a) * this.rate.slopeFactor;
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a * bIn[i  ]; a += a_slope;
      out[i+1] = a * bIn[i+1]; a += a_slope;
      out[i+2] = a * bIn[i+2]; a += a_slope;
      out[i+3] = a * bIn[i+3]; a += a_slope;
      out[i+4] = a * bIn[i+4]; a += a_slope;
      out[i+5] = a * bIn[i+5]; a += a_slope;
      out[i+6] = a * bIn[i+6]; a += a_slope;
      out[i+7] = a * bIn[i+7]; a += a_slope;
    }
    this._a = nextA;
  };
  calcFunc["*"].kk = function() {
    this.outputs[0][0] = this.inputs[0][0] * this.inputs[1][0];
  };
  calcFunc["*"].ia = function(inNumSamples) {
    var out = this.outputs[0];
    var a = this._a, bIn = this.inputs[1];
    for (var i = 0; i < inNumSamples; i += 8) {
      out[i  ] = a * bIn[i  ];
      out[i+1] = a * bIn[i+1];
      out[i+2] = a * bIn[i+2];
      out[i+3] = a * bIn[i+3];
      out[i+4] = a * bIn[i+4];
      out[i+5] = a * bIn[i+5];
      out[i+6] = a * bIn[i+6];
      out[i+7] = a * bIn[i+7];
    }
  };

  calcFunc["/"] = function(a, b) {
    return b === 0 ? 0 : a / b;
  };
  calcFunc["%"] = function(a, b) {
    return b === 0 ? 0 : a % b;
  };
  
  Object.keys(calcFunc).forEach(function(key) {
    var func = calcFunc[key];
    if (!func.aa) { func.aa = binary_aa(func); }
    if (!func.ak) { func.ak = binary_ak(func); }
    if (!func.ai) { func.ai = binary_ai(func); }
    if (!func.ka) { func.ka = binary_ka(func); }
    if (!func.kk) { func.kk = binary_kk(func); }
    if (!func.ki) { func.ki = func.kk; }
    if (!func.ia) { func.ia = binary_ia(func); }
    if (!func.ik) { func.ik = func.kk; }
  });
  
  module.exports = {};

});
define('cc/server/unit/bufio', function(require, exports, module) {
  
  var unit = require("./unit");
  
  var sc_loop = function(unit, index, hi, loop) {
    if (index >= hi) {
      if (!loop) {
        unit.done = true;
        return hi;
      }
      index -= hi;
      if (index < hi) {
        return index;
      }
    } else if (index < 0) {
      if (!loop) {
        unit.done = true;
        return 0;
      }
      index += hi;
      if (index >= 0) {
        return index;
      }
    } else {
      return index;
    }
    return index - hi * Math.floor(index/hi);
  };
  
  var cubicinterp = function(x, y0, y1, y2, y3) {
    var c0 = y1;
    var c1 = 0.5 * (y2 - y0);
    var c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    var c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * x + c2) * x + c1) * x + c0;
  };
  
  unit.specs.PlayBuf = (function() {
    var ctor = function() {
      this._buffer = null;
      this._phase  = this.inputs[3][0];
      this._trig   = 0;
      this.process = next_choose;
    };
    
    var next_choose = function(inNumSamples, instance) {
      this._buffer = instance.buffers[this.specialIndex];
      if (this._buffer) {
        if (this._buffer.samples !== null) {
          if (this.inRates[1] === 2) {
            if (this.inRates[2] === 2) {
              this.process = next_kk; // TODO: implements aa
            } else {
              this.process = next_kk; // TODO: implements ak
            }
          } else {
            if (this.inRates[2] === 2) {
              this.process = next_kk; // TODO: implements ka
            } else {
              this.process = next_kk;
            }
          }
          this.process.call(this, inNumSamples);
          delete this.spec;
        }
      }
    };
    var next_kk = function(inNumSamples) {
      var buf = this._buffer;
      var outputs = this.outputs;
      var phase = this._phase;
      var rate  = this.inputs[1][0];
      var trig  = this.inputs[2][0];
      var loop  = this.inputs[4][0];
      var samples  = buf.samples;
      var channels = buf.channels;
      var frames   = buf.frames;
      var index0, index1, index2, index3, frac, a, b, c, d;

      var hi = frames - 1;
      if (trig > 0 && this._trig <= 0) {
        this.done = false;
        phase = this.inputs[3][0];
      }
      this._trig = trig;
      for (var i = 0; i < inNumSamples; ++i) {
        phase = sc_loop(this, phase, hi, loop);
        index1 = phase|0;
        index0 = index1 - 1;
        index2 = index1 + 1;
        index3 = index2 + 1;
        if (index1 === 0) {
          if (loop) {
            index0 = hi;
          } else {
            index0 = index1;
          }
        } else if (index3 > hi) {
          if (index2 > hi) {
            if (loop) {
              index2 = 0;
              index3 = 1;
            } else {
              index2 = index3 = hi;
            }
          } else {
            if (loop) {
              index3 = 0;
            } else {
              index3 = hi;
            }
          }
        }
        frac = phase - (phase|0);
        for (var j = 0, jmax = outputs.length; j < jmax; ++j) {
          a = samples[index0 * channels + j];
          b = samples[index1 * channels + j];
          c = samples[index2 * channels + j];
          d = samples[index3 * channels + j];
          outputs[j][i] = cubicinterp(frac, a, b, c, d);
        }
        phase += rate;
      }
      if (this.done) {
        this.doneAction(this.inputs[5][0]|0, this.tag);
      }
      this._phase = phase;
    };

    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/delay', function(require, exports, module) {

  var unit = require("./unit");
  var log001 = Math.log(0.001);

  var calcDelay = function(unit, delaytime, minDelay) {
    return Math.max(minDelay, Math.min(delaytime * unit.rate.sampleRate, unit._fdelaylen));
  };
  var calcFeedback = function(delaytime, decaytime) {
    if (delaytime === 0 || decaytime === 0) {
      return 0;
    }
    if (decaytime > 0) {
      return +Math.exp(log001 * delaytime / +decaytime);
    } else {
      return -Math.exp(log001 * delaytime / -decaytime);
    }
  };
  var cubicinterp = function(x, y0, y1, y2, y3) {
    var c0 = y1;
    var c1 = 0.5 * (y2 - y0);
    var c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    var c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * x + c2) * x + c1) * x + c0;
  };

  var feedbackdelay_ctor = function() {
    var delaybufsize;
    this._maxdelaytime = this.inputs[1][0];
    this._delaytime    = this.inputs[2][0];
    this._decaytime    = this.inputs[3][0];
    delaybufsize = Math.ceil(this._maxdelaytime * this.rate.sampleRate + 1);
    delaybufsize = delaybufsize + this.rate.bufLength;
    delaybufsize = 1 << Math.ceil(Math.log(delaybufsize) * Math.LOG2E);
    this._fdelaylen = this._idelaylen = delaybufsize;
    this._dlybuf    = new Float32Array(delaybufsize);
    this._mask      = delaybufsize - 1;
    this._dsamp     = calcDelay(this, this._delaytime, 1);
    this._iwrphase  = 0;
    this._feedbk    = calcFeedback(this._delaytime, this._decaytime);
  };

  unit.specs.CombN = (function() {
    var ctor = function() {
      this.process = next_akk;
      feedbackdelay_ctor.call(this);
    };
    var next_akk = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var delaytime = this.inputs[2][0];
      var decaytime = this.inputs[3][0];
      var dlybuf   = this._dlybuf;
      var iwrphase = this._iwrphase;
      var dsamp    = this._dsamp;
      var feedbk   = this._feedbk;
      var mask     = this._mask;
      var irdphase, value;
      var next_feedbk, feedbk_slope, next_dsamp, dsamp_slope;
      var i;
      if (delaytime === this._delaytime) {
        irdphase = iwrphase - (dsamp|0);
        if (decaytime === this._decaytime) {
          for (i = 0; i < inNumSamples; ++i) {
            value = dlybuf[irdphase & mask];
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            irdphase++;
            iwrphase++;
          }
        } else {
          next_feedbk  = calcFeedback(delaytime, decaytime);
          feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
          for (i = 0; i < inNumSamples; ++i) {
            value = dlybuf[irdphase & mask];
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            feedbk += feedbk_slope;
            irdphase++;
            iwrphase++;
          }
          this._feedbk = next_feedbk;
          this._decaytime = decaytime;
        }
      } else {
        next_dsamp  = calcDelay(this, delaytime, 1);
        dsamp_slope = (next_dsamp - dsamp) * this.rate.slopeFactor;
        next_feedbk  = calcFeedback(delaytime, decaytime);
        feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          irdphase = iwrphase - (dsamp|0);
          value = dlybuf[irdphase & mask];
          dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
          out[i] = value;
          dsamp  += dsamp_slope;
          feedbk += feedbk_slope;
          irdphase++;
          iwrphase++;
        }
        this._feedbk = feedbk;
        this._dsamp  = dsamp;
        this._delaytime = delaytime;
        this._decaytime = decaytime;
      }
      this._iwrphase = iwrphase;
    };

    return ctor;
  })();

  unit.specs.CombL = (function() {
    var ctor = function() {
      this.process = next_akk;
      feedbackdelay_ctor.call(this);
    };
    var next_akk = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn = this.inputs[0];
      var delaytime = this.inputs[2][0];
      var decaytime = this.inputs[3][0];
      var dlybuf   = this._dlybuf;
      var iwrphase = this._iwrphase;
      var dsamp    = this._dsamp;
      var feedbk   = this._feedbk;
      var mask     = this._mask;
      var frac     = dsamp - (dsamp|0);
      var irdphase, value, d1, d2;
      var next_feedbk, feedbk_slope, next_dsamp, dsamp_slope;
      var i;
      if (delaytime === this._delaytime) {
        irdphase = iwrphase - (dsamp|0);
        if (decaytime === this._decaytime) {
          for (i = 0; i < inNumSamples; ++i) {
            d1 = dlybuf[(irdphase  )&mask];
            d2 = dlybuf[(irdphase-1)&mask];
            value = d1 + frac * (d2 - d1);
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            irdphase++;
            iwrphase++;
          }
        } else {
          next_feedbk  = calcFeedback(delaytime, decaytime);
          feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
          for (i = 0; i < inNumSamples; ++i) {
            d1 = dlybuf[(irdphase  )&mask];
            d2 = dlybuf[(irdphase-1)&mask];
            value = d1 + frac * (d2 - d1);
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            feedbk += feedbk_slope;
            irdphase++;
            iwrphase++;
          }
          this._feedbk = next_feedbk;
          this._decaytime = decaytime;
        }
      } else {
        next_dsamp  = calcDelay(this, delaytime, 1);
        dsamp_slope = (next_dsamp - dsamp) * this.rate.slopeFactor;
        next_feedbk  = calcFeedback(delaytime, decaytime);
        feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          irdphase = iwrphase - (dsamp|0);
          d1 = dlybuf[(irdphase  )&mask];
          d2 = dlybuf[(irdphase-1)&mask];
          value = d1 + frac * (d2 - d1);
          dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
          out[i] = value;
          dsamp  += dsamp_slope;
          feedbk += feedbk_slope;
          irdphase++;
          iwrphase++;
        }
        this._feedbk = feedbk;
        this._dsamp  = dsamp;
        this._delaytime = delaytime;
        this._decaytime = decaytime;
      }
      this._iwrphase = iwrphase;
    };

    return ctor;
  })();
  
  unit.specs.CombC = (function() {
    var ctor = function() {
      this.process = next_akk;
      feedbackdelay_ctor.call(this);
    };
    var next_akk = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var delaytime = this.inputs[2][0];
      var decaytime = this.inputs[3][0];
      var dlybuf   = this._dlybuf;
      var iwrphase = this._iwrphase;
      var dsamp    = this._dsamp;
      var feedbk   = this._feedbk;
      var mask     = this._mask;
      var frac     = dsamp - (dsamp|0);
      var irdphase, value, d0, d1, d2, d3;
      var next_feedbk, feedbk_slope, next_dsamp, dsamp_slope;
      var i;
      if (delaytime === this._delaytime) {
        irdphase = iwrphase - (dsamp|0);
        if (decaytime === this._decaytime) {
          for (i = 0; i < inNumSamples; ++i) {
            d0 = dlybuf[(irdphase+1)&mask];
            d1 = dlybuf[(irdphase  )&mask];
            d2 = dlybuf[(irdphase-1)&mask];
            d3 = dlybuf[(irdphase-2)&mask];
            value = cubicinterp(frac, d0, d1, d2, d3);
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            irdphase++;
            iwrphase++;
          }
        } else {
          next_feedbk  = calcFeedback(delaytime, decaytime);
          feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
          for (i = 0; i < inNumSamples; ++i) {
            d0 = dlybuf[(irdphase+1)&mask];
            d1 = dlybuf[(irdphase  )&mask];
            d2 = dlybuf[(irdphase-1)&mask];
            d3 = dlybuf[(irdphase-2)&mask];
            value = cubicinterp(frac, d0, d1, d2, d3);
            dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
            out[i] = value;
            feedbk += feedbk_slope;
            irdphase++;
            iwrphase++;
          }
          this._feedbk = next_feedbk;
          this._decaytime = decaytime;
        }
      } else {
        next_dsamp  = calcDelay(this, delaytime, 1);
        dsamp_slope = (next_dsamp - dsamp) * this.rate.slopeFactor;
        next_feedbk  = calcFeedback(delaytime, decaytime);
        feedbk_slope = (next_feedbk - feedbk) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          irdphase = iwrphase - (dsamp|0);
          d0 = dlybuf[(irdphase+1)&mask];
          d1 = dlybuf[(irdphase  )&mask];
          d2 = dlybuf[(irdphase-1)&mask];
          d3 = dlybuf[(irdphase-2)&mask];
          value = cubicinterp(frac, d0, d1, d2, d3);
          dlybuf[iwrphase & mask] = inIn[i] + feedbk * value;
          out[i] = value;
          dsamp  += dsamp_slope;
          feedbk += feedbk_slope;
          irdphase++;
          iwrphase++;
        }
        this._feedbk = feedbk;
        this._dsamp  = dsamp;
        this._delaytime = delaytime;
        this._decaytime = decaytime;
      }
      this._iwrphase = iwrphase;
    };

    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/inout', function(require, exports, module) {

  var cc = require("../cc");
  var unit = require("./unit");
  
  unit.specs.Control = (function() {
    var ctor = function() {
      if (this.numOfOutputs === 1) {
        this.process = next_1;
      } else {
        this.process = next_k;
      }
      this.process(1);
    };
    var next_1 = function() {
      this.outputs[0][0] = this.parent.controls[this.specialIndex];
    };
    var next_k = function() {
      var controls = this.parent.controls;
      var outputs = this.outputs;
      var specialIndex = this.specialIndex;
      for (var i = 0, imax = outputs.length; i < imax; ++i) {
        outputs[i][0] = controls[i + specialIndex];
      }
    };
    return ctor;
  })();
  
  unit.specs.In = (function() {
    var ctor = function() {
      this._bufLength = cc.server.bufLength;
      if (this.calcRate === 2) {
        this.process = next_a;
        this._busOffset = 0;
      } else {
        this.process = next_k;
        this._busOffset = this._bufLength * 16;
      }
    };
    var next_a = function(inNumSamples, instance) {
      var out = this.outputs[0];
      var bus  = instance.bus;
      var bufLength = this._bufLength;
      var offset = (this.inputs[0][0] * bufLength)|0;
      for (var i = 0; i < inNumSamples; ++i) {
        out[i] = bus[offset + i];
      }
    };
    var next_k = function(inNumSamples, instance) {
      var out = this.outputs[0];
      var value = instance.bus[this._busOffset + (this.inputs[0][0]|0)];
      for (var i = 0; i < inNumSamples; ++i) {
        out[i] = value;
      }
    };
    return ctor;
  })();
  
  unit.specs.Out = (function() {
    var ctor = function() {
      this._bufLength = cc.server.bufLength;
      if (this.calcRate === 2) {
        this.process = next_a;
        this._busOffset = 0;
      } else {
        this.process = next_k;
        this._busOffset = this._bufLength * 16;
      }
    };
    var next_a = function(inNumSamples, instance) {
      var inputs = this.inputs;
      var bus    = instance.bus;
      var bufLength = this._bufLength;
      var offset, _in;
      var fbusChannel = (inputs[0][0]|0) - 1;
      for (var i = 1, imax = inputs.length; i < imax; ++i) {
        offset = (fbusChannel + i) * bufLength;
        _in = inputs[i];
        for (var j = 0; j < inNumSamples; j++) {
          bus[offset + j] += _in[j];
        }
      }
    };
    var next_k = function(inNumSamples, instance) {
      var inputs = this.inputs;
      var bus    = instance.bus;
      var offset    = this._busOffset + (inputs[0][0]|0) - 1;
      for (var i = 1, imax = inputs.length; i < imax; ++i) {
        bus[offset + i] += inputs[i][0];
      }
    };
    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/line', function(require, exports, module) {

  var unit = require("./unit");
  
  unit.specs.Line = (function() {
    var ctor = function() {
      this.process = next_kkk;
      var start = this.inputs[0][0];
      var end = this.inputs[1][0];
      var dur = this.inputs[2][0];
      var counter = Math.round(dur * this.rate.sampleRate);
      this._counter = Math.max(1, counter);
      if (counter === 0) {
        this._level = end;
        this._slope = 0;
      } else {
        this._slope = (end - start) / this._counter;
        this._level = start + this._slope;
      }
      this._endLevel = end;
      this._doneAction = this.inputs[3][0];
      this.outputs[0][0] = this._level;
    };
    var next_kkk = function(inNumSamples) {
      var out = this.outputs[0];
      var level   = this._level;
      var counter = this._counter;
      var slope   = this._slope;
      var i, remain = inNumSamples;
      do {
        var nsmps;
        if (counter === 0) {
          nsmps  = remain;
          remain = 0;
          var endLevel = this._endLevel;
          for (i = 0; i < nsmps; ++i) {
            out[i] = endLevel;
          }
        } else {
          nsmps = Math.min(remain, counter);
          counter -= nsmps;
          remain  -= nsmps;
          for (i = 0; i < nsmps; ++i) {
            out[i] = level;
            level += slope;
          }
          if (counter === 0) {
            this.doneAction(this._doneAction);
          }
        }
      } while (remain);
      this._counter = counter;
      this._level   = level;
    };
    
    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/madd', function(require, exports, module) {

  var unit = require("./unit");
  
  unit.specs.MulAdd = (function() {
    var ctor = function() {
      var rates = this.inRates;
      var process = next[rates[0]][rates[1]][rates[2]];
      this.process = process;
      this._in  = this.inputs[0][0];
      this._mul = this.inputs[1][0];
      this._add = this.inputs[2][0];
      if (this.process) {
        this.process(1);
      } else {
        this.outputs[0][0] = this._in * this._mul + this._add;
      }
    };

    var next = {};
    next[2] = {};
    next[2][2] = {};
    next[2][1] = {};
    next[2][0] = {};
    next[1] = {};
    next[1][2] = {};
    next[1][1] = {};
    next[1][0] = {};
    next[0] = {};
    next[0][2] = {};
    next[0][1] = {};
    next[0][0] = {};

    next[2][2][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn  = this.inputs[0];
      var mulIn = this.inputs[1];
      var addIn = this.inputs[2];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mulIn[i  ] + addIn[i  ];
        out[i+1] = inIn[i+1] * mulIn[i+1] + addIn[i+1];
        out[i+2] = inIn[i+2] * mulIn[i+2] + addIn[i+2];
        out[i+3] = inIn[i+3] * mulIn[i+3] + addIn[i+3];
        out[i+4] = inIn[i+4] * mulIn[i+4] + addIn[i+4];
        out[i+5] = inIn[i+5] * mulIn[i+5] + addIn[i+5];
        out[i+6] = inIn[i+6] * mulIn[i+6] + addIn[i+6];
        out[i+7] = inIn[i+7] * mulIn[i+7] + addIn[i+7];
      }
    };
    next[2][2][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn  = this.inputs[0];
      var mulIn = this.inputs[1];
      var add = this._add;
      var nextAdd = this.inputs[2][0];
      var add_slope = (nextAdd - add) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mulIn[i  ] + add; add += add_slope;
        out[i+1] = inIn[i+1] * mulIn[i+1] + add; add += add_slope;
        out[i+2] = inIn[i+2] * mulIn[i+2] + add; add += add_slope;
        out[i+3] = inIn[i+3] * mulIn[i+3] + add; add += add_slope;
        out[i+4] = inIn[i+4] * mulIn[i+4] + add; add += add_slope;
        out[i+5] = inIn[i+5] * mulIn[i+5] + add; add += add_slope;
        out[i+6] = inIn[i+6] * mulIn[i+6] + add; add += add_slope;
        out[i+7] = inIn[i+7] * mulIn[i+7] + add; add += add_slope;
      }
      this._add = nextAdd;
    };
    next[2][2][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn  = this.inputs[0];
      var mulIn = this.inputs[1];
      var add = this._add;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mulIn[i  ] + add;
        out[i+1] = inIn[i+1] * mulIn[i+1] + add;
        out[i+2] = inIn[i+2] * mulIn[i+2] + add;
        out[i+3] = inIn[i+3] * mulIn[i+3] + add;
        out[i+4] = inIn[i+4] * mulIn[i+4] + add;
        out[i+5] = inIn[i+5] * mulIn[i+5] + add;
        out[i+6] = inIn[i+6] * mulIn[i+6] + add;
        out[i+7] = inIn[i+7] * mulIn[i+7] + add;
      }
    };
    next[2][1][2] = function(inNumSamples) {
      var out   = this.outputs[0];
      var inIn  = this.inputs[0];
      var mul   = this._mul;
      var addIn = this.inputs[2];
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + addIn[i  ]; mul += mul_slope;
        out[i+1] = inIn[i+1] * mul + addIn[i+1]; mul += mul_slope;
        out[i+2] = inIn[i+2] * mul + addIn[i+2]; mul += mul_slope;
        out[i+3] = inIn[i+3] * mul + addIn[i+3]; mul += mul_slope;
        out[i+4] = inIn[i+4] * mul + addIn[i+4]; mul += mul_slope;
        out[i+5] = inIn[i+5] * mul + addIn[i+5]; mul += mul_slope;
        out[i+6] = inIn[i+6] * mul + addIn[i+6]; mul += mul_slope;
        out[i+7] = inIn[i+7] * mul + addIn[i+7]; mul += mul_slope;
      }
      this._mul = nextMul;
    };
    next[2][1][1] = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var mul  = this._mul;
      var add  = this._add;
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      var nextAdd = this.inputs[2][0];
      var add_slope = (nextAdd - add) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + add; mul += mul_slope; add += add_slope;
        out[i+1] = inIn[i+1] * mul + add; mul += mul_slope; add += add_slope;
        out[i+2] = inIn[i+2] * mul + add; mul += mul_slope; add += add_slope;
        out[i+3] = inIn[i+3] * mul + add; mul += mul_slope; add += add_slope;
        out[i+4] = inIn[i+4] * mul + add; mul += mul_slope; add += add_slope;
        out[i+5] = inIn[i+5] * mul + add; mul += mul_slope; add += add_slope;
        out[i+6] = inIn[i+6] * mul + add; mul += mul_slope; add += add_slope;
        out[i+7] = inIn[i+7] * mul + add; mul += mul_slope; add += add_slope;
      }
      this._mul = nextMul;
      this._add = nextAdd;
    };
    next[2][1][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn  = this.inputs[0];
      var mul   = this._mul;
      var add = this._add;
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + add; mul += mul_slope;
        out[i+1] = inIn[i+1] * mul + add; mul += mul_slope;
        out[i+2] = inIn[i+2] * mul + add; mul += mul_slope;
        out[i+3] = inIn[i+3] * mul + add; mul += mul_slope;
        out[i+4] = inIn[i+4] * mul + add; mul += mul_slope;
        out[i+5] = inIn[i+5] * mul + add; mul += mul_slope;
        out[i+6] = inIn[i+6] * mul + add; mul += mul_slope;
        out[i+7] = inIn[i+7] * mul + add; mul += mul_slope;
      }
      this._mul = nextMul;
    };
    next[2][0][2] = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var mul  = this._mul;
      var addIn = this.inputs[2];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + addIn[i  ];
        out[i+1] = inIn[i+1] * mul + addIn[i+1];
        out[i+2] = inIn[i+2] * mul + addIn[i+2];
        out[i+3] = inIn[i+3] * mul + addIn[i+3];
        out[i+4] = inIn[i+4] * mul + addIn[i+4];
        out[i+5] = inIn[i+5] * mul + addIn[i+5];
        out[i+6] = inIn[i+6] * mul + addIn[i+6];
        out[i+7] = inIn[i+7] * mul + addIn[i+7];
      }
    };
    next[2][0][1] = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var mul  = this._mul;
      var add  = this._add;
      var nextAdd = this.inputs[2][0];
      var add_slope = (nextAdd - add) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + add; add += add_slope;
        out[i+1] = inIn[i+1] * mul + add; add += add_slope;
        out[i+2] = inIn[i+2] * mul + add; add += add_slope;
        out[i+3] = inIn[i+3] * mul + add; add += add_slope;
        out[i+4] = inIn[i+4] * mul + add; add += add_slope;
        out[i+5] = inIn[i+5] * mul + add; add += add_slope;
        out[i+6] = inIn[i+6] * mul + add; add += add_slope;
        out[i+7] = inIn[i+7] * mul + add; add += add_slope;
      }
      this._add = nextAdd;
    };
    next[2][0][0] = function(inNumSamples) {
      var out  = this.outputs[0];
      var inIn = this.inputs[0];
      var mul  = this._mul;
      var add  = this._add;
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn[i  ] * mul + add; mul += mul_slope;
        out[i+1] = inIn[i+1] * mul + add; mul += mul_slope;
        out[i+2] = inIn[i+2] * mul + add; mul += mul_slope;
        out[i+3] = inIn[i+3] * mul + add; mul += mul_slope;
        out[i+4] = inIn[i+4] * mul + add; mul += mul_slope;
        out[i+5] = inIn[i+5] * mul + add; mul += mul_slope;
        out[i+6] = inIn[i+6] * mul + add; mul += mul_slope;
        out[i+7] = inIn[i+7] * mul + add; mul += mul_slope;
      }
      this._mul = nextMul;
    };
    next[1][1][2] = function(inNumSamples) {
      var out   = this.outputs[0];
      var _in   = this._in;
      var mul   = this._mul;
      var addIn = this.inputs[2];
      var nextIn = this.inputs[0][0];
      var in_slope = (nextIn - _in) * this.rate.slopeFactor;
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mul + addIn[i  ]; _in += in_slope; mul += mul_slope;
        out[i+1] = _in * mul + addIn[i+1]; _in += in_slope; mul += mul_slope;
        out[i+2] = _in * mul + addIn[i+2]; _in += in_slope; mul += mul_slope;
        out[i+3] = _in * mul + addIn[i+3]; _in += in_slope; mul += mul_slope;
        out[i+4] = _in * mul + addIn[i+4]; _in += in_slope; mul += mul_slope;
        out[i+5] = _in * mul + addIn[i+5]; _in += in_slope; mul += mul_slope;
        out[i+6] = _in * mul + addIn[i+6]; _in += in_slope; mul += mul_slope;
        out[i+7] = _in * mul + addIn[i+7]; _in += in_slope; mul += mul_slope;
      }
      this._in  = nextIn;
      this._mul = nextMul;
    };
    next[1][1][1] = function() {
      this.outputs[0][0] = this.inputs[0][0] * this.inputs[1][0] + this.inputs[2][0];
    };
    next[1][1][0] = function() {
      this.outputs[0][0] = this.inputs[0][0] * this.inputs[1][0] + this._add;
    };
    next[1][0][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mul   = this._mul;
      var addIn = this.inputs[2];
      var nextIn = this.inputs[0][0];
      var in_slope = (nextIn - _in) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mul + addIn[i  ]; _in += in_slope;
        out[i+1] = _in * mul + addIn[i+1]; _in += in_slope;
        out[i+2] = _in * mul + addIn[i+2]; _in += in_slope;
        out[i+3] = _in * mul + addIn[i+3]; _in += in_slope;
        out[i+4] = _in * mul + addIn[i+4]; _in += in_slope;
        out[i+5] = _in * mul + addIn[i+5]; _in += in_slope;
        out[i+6] = _in * mul + addIn[i+6]; _in += in_slope;
        out[i+7] = _in * mul + addIn[i+7]; _in += in_slope;
      }
      this._in  = nextIn;
    };
    next[1][0][1] = function() {
      this.outputs[0][0] = this.inputs[0][0] * this._mul + this.inputs[2][0];
    };
    next[1][0][0] = function() {
      this.outputs[0][0] = this.inputs[0][0] * this._mul + this._add;
    };
    next[0][2][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mulIn = this.inputs[1];
      var addIn = this.inputs[2];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mulIn[i  ] + addIn[i  ];
        out[i+1] = _in * mulIn[i+1] + addIn[i+1];
        out[i+2] = _in * mulIn[i+2] + addIn[i+2];
        out[i+3] = _in * mulIn[i+3] + addIn[i+3];
        out[i+4] = _in * mulIn[i+4] + addIn[i+4];
        out[i+5] = _in * mulIn[i+5] + addIn[i+5];
        out[i+6] = _in * mulIn[i+6] + addIn[i+6];
        out[i+7] = _in * mulIn[i+7] + addIn[i+7];
      }
    };
    next[0][2][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mulIn = this.inputs[1];
      var add = this._add;
      var nextAdd = this.inputs[2][0];
      var add_slope = (nextAdd - add) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mulIn[i  ] + add; add += add_slope;
        out[i+1] = _in * mulIn[i+1] + add; add += add_slope;
        out[i+2] = _in * mulIn[i+2] + add; add += add_slope;
        out[i+3] = _in * mulIn[i+3] + add; add += add_slope;
        out[i+4] = _in * mulIn[i+4] + add; add += add_slope;
        out[i+5] = _in * mulIn[i+5] + add; add += add_slope;
        out[i+6] = _in * mulIn[i+6] + add; add += add_slope;
        out[i+7] = _in * mulIn[i+7] + add; add += add_slope;
      }
      this._add = nextAdd;
    };
    next[0][2][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mulIn = this.inputs[1];
      var add = this._add;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mulIn[i  ] + add;
        out[i+1] = _in * mulIn[i+1] + add;
        out[i+2] = _in * mulIn[i+2] + add;
        out[i+3] = _in * mulIn[i+3] + add;
        out[i+4] = _in * mulIn[i+4] + add;
        out[i+5] = _in * mulIn[i+5] + add;
        out[i+6] = _in * mulIn[i+6] + add;
        out[i+7] = _in * mulIn[i+7] + add;
      }
    };
    next[0][1][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mul   = this._mul;
      var addIn = this.inputs[2];
      var nextMul = this.inputs[1][0];
      var mul_slope = (nextMul - mul) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mul + addIn[i  ]; mul += mul_slope;
        out[i+1] = _in * mul + addIn[i+1]; mul += mul_slope;
        out[i+2] = _in * mul + addIn[i+2]; mul += mul_slope;
        out[i+3] = _in * mul + addIn[i+3]; mul += mul_slope;
        out[i+4] = _in * mul + addIn[i+4]; mul += mul_slope;
        out[i+5] = _in * mul + addIn[i+5]; mul += mul_slope;
        out[i+6] = _in * mul + addIn[i+6]; mul += mul_slope;
        out[i+7] = _in * mul + addIn[i+7]; mul += mul_slope;
      }
      this._mul = nextMul;
    };
    next[0][1][1] = function() {
      this.outputs[0][0] = this._in * this.inputs[1][0] + this.inputs[2][0];
    };
    next[0][1][0] = function() {
      this.outputs[0][0] = this._in * this.inputs[1][0] + this._add;
    };
    next[0][0][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var _in   = this._in;
      var mul   = this._mul;
      var addIn = this.inputs[2];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = _in * mul + addIn[i  ];
        out[i+1] = _in * mul + addIn[i+1];
        out[i+2] = _in * mul + addIn[i+2];
        out[i+3] = _in * mul + addIn[i+3];
        out[i+4] = _in * mul + addIn[i+4];
        out[i+5] = _in * mul + addIn[i+5];
        out[i+6] = _in * mul + addIn[i+6];
        out[i+7] = _in * mul + addIn[i+7];
      }
    };
    next[0][0][1] = function() {
      this.outputs[0][0] = this._in * this._mul + this.inputs[2][0];
    };
    
    return ctor;
  })();

  unit.specs.Sum3 = (function() {
    var ctor = function() {
      var rates = this.inRates;
      var process = next[rates[0]][rates[1]][rates[2]];
      this.process = process;
      this._in0 = this.inputs[0][0];
      this._in1 = this.inputs[1][0];
      this._in2 = this.inputs[2][0];
      if (this.process) {
        this.process(1);
      } else {
        this.outputs[0][0] = this._in0 * this._in1 + this._in2;
      }
    };
    
    var next = {};
    next[2] = {};
    next[2][2] = {};
    next[2][1] = {};
    next[2][0] = {};
    next[1] = {};
    next[1][1] = {};
    next[1][0] = {};

    next[2][2][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var inIn2 = this.inputs[2];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + inIn2[i  ];
        out[i+1] = inIn0[i+1] + inIn1[i+1] + inIn2[i+1];
        out[i+2] = inIn0[i+2] + inIn1[i+2] + inIn2[i+2];
        out[i+3] = inIn0[i+3] + inIn1[i+3] + inIn2[i+3];
        out[i+4] = inIn0[i+4] + inIn1[i+4] + inIn2[i+4];
        out[i+5] = inIn0[i+5] + inIn1[i+5] + inIn2[i+5];
        out[i+6] = inIn0[i+6] + inIn1[i+6] + inIn2[i+6];
        out[i+7] = inIn0[i+7] + inIn1[i+7] + inIn2[i+7];
      }
    };
    next[2][2][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var in2   = this._in2;
      var nextIn2 = this.inputs[2][0];
      var in2_slope = (nextIn2 - in2) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + in2; in2 += in2_slope;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + in2; in2 += in2_slope;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + in2; in2 += in2_slope;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + in2; in2 += in2_slope;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + in2; in2 += in2_slope;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + in2; in2 += in2_slope;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + in2; in2 += in2_slope;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + in2; in2 += in2_slope;
      }
      this._in2 = nextIn2;
    };
    next[2][2][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var in2   = this._in2;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + in2;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + in2;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + in2;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + in2;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + in2;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + in2;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + in2;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + in2;
      }
    };
    next[2][1][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var in12  = this._in1 + this._in2;
      var nextIn12 = this.inputs[1][0] + this.inputs[2][0];
      var in12_slope = (nextIn12 - in12) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + in12; in12 += in12_slope;
        out[i+1] = inIn0[i+1] + in12; in12 += in12_slope;
        out[i+2] = inIn0[i+2] + in12; in12 += in12_slope;
        out[i+3] = inIn0[i+3] + in12; in12 += in12_slope;
        out[i+4] = inIn0[i+4] + in12; in12 += in12_slope;
        out[i+5] = inIn0[i+5] + in12; in12 += in12_slope;
        out[i+6] = inIn0[i+6] + in12; in12 += in12_slope;
        out[i+7] = inIn0[i+7] + in12; in12 += in12_slope;
      }
      this._in1 = this.inputs[1][0];
      this._in2 = this.inputs[2][0];
    };
    next[2][1][0] = next[2][1][1];
    next[2][0][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var in12  = this._in1 + this._in2;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + in12;
        out[i+1] = inIn0[i+1] + in12;
        out[i+2] = inIn0[i+2] + in12;
        out[i+3] = inIn0[i+3] + in12;
        out[i+4] = inIn0[i+4] + in12;
        out[i+5] = inIn0[i+5] + in12;
        out[i+6] = inIn0[i+6] + in12;
        out[i+7] = inIn0[i+7] + in12;
      }
    };
    next[1][1][1] = function() {
      this.outputs[0][0] = this.inputs[0][0] + this.inputs[1][0] + this.inputs[2][0];
    };
    next[1][1][0] = next[1][1][1];
    next[1][0][0] = next[1][1][1];

    return ctor;
  })();
  
  unit.specs.Sum4 = (function() {
    var ctor = function() {
      var rates = this.inRates;
      var process = next[rates[0]][rates[1]][rates[2]][rates[3]];
      this.process = process;
      this._in0 = this.inputs[0][0];
      this._in1 = this.inputs[1][0];
      this._in2 = this.inputs[2][0];
      this._in3 = this.inputs[3][0];
      if (this.process) {
        this.process(1);
      } else {
        this.outputs[0][0] = this._in0 * this._in1 + this._in2 + this._in3;
      }
    };

    var next = {};
    next[2] = {};
    next[2][2] = {};
    next[2][2][2] = {};
    next[2][2][1] = {};
    next[2][2][0] = {};
    next[2][1] = {};
    next[2][1][1] = {};
    next[2][1][0] = {};
    next[2][0] = {};
    next[2][0][0] = {};
    next[1] = {};
    next[1][1] = {};
    next[1][1][1] = {};
    next[1][1][0] = {};
    next[1][0] = {};
    next[1][0][0] = {};
    next[0] = {};
    next[0][0] = {};
    next[0][0][0] = {};
    
    next[2][2][2][2] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var inIn2 = this.inputs[2];
      var inIn3 = this.inputs[3];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + inIn2[i  ] + inIn3[i  ];
        out[i+1] = inIn0[i+1] + inIn1[i+1] + inIn2[i+1] + inIn3[i+1];
        out[i+2] = inIn0[i+2] + inIn1[i+2] + inIn2[i+2] + inIn3[i+2];
        out[i+3] = inIn0[i+3] + inIn1[i+3] + inIn2[i+3] + inIn3[i+3];
        out[i+4] = inIn0[i+4] + inIn1[i+4] + inIn2[i+4] + inIn3[i+4];
        out[i+5] = inIn0[i+5] + inIn1[i+5] + inIn2[i+5] + inIn3[i+5];
        out[i+6] = inIn0[i+6] + inIn1[i+6] + inIn2[i+6] + inIn3[i+6];
        out[i+7] = inIn0[i+7] + inIn1[i+7] + inIn2[i+7] + inIn3[i+7];
      }
    };
    next[2][2][2][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var inIn2 = this.inputs[2];
      var in3   = this._in3;
      var nextIn3 = this.inputs[3][0];
      var in3_slope = (nextIn3 - in3) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + inIn2[i  ] + in3; in3 += in3_slope;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + inIn2[i+1] + in3; in3 += in3_slope;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + inIn2[i+2] + in3; in3 += in3_slope;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + inIn2[i+3] + in3; in3 += in3_slope;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + inIn2[i+4] + in3; in3 += in3_slope;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + inIn2[i+5] + in3; in3 += in3_slope;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + inIn2[i+6] + in3; in3 += in3_slope;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + inIn2[i+7] + in3; in3 += in3_slope;
      }
      this._in3 = nextIn3;
    };
    next[2][2][2][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var inIn2 = this.inputs[2];
      var in3   = this._in3;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + inIn2[i  ] + in3;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + inIn2[i+1] + in3;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + inIn2[i+2] + in3;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + inIn2[i+3] + in3;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + inIn2[i+4] + in3;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + inIn2[i+5] + in3;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + inIn2[i+6] + in3;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + inIn2[i+7] + in3;
      }
    };
    next[2][2][1][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var in23  = this._in2 + this._in3;
      var nextIn23 = this.inputs[2][0] + this.inputs[3][0];
      var in23_slope = (nextIn23 - in23) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + in23; in23 += in23_slope;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + in23; in23 += in23_slope;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + in23; in23 += in23_slope;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + in23; in23 += in23_slope;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + in23; in23 += in23_slope;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + in23; in23 += in23_slope;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + in23; in23 += in23_slope;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + in23; in23 += in23_slope;
      }
      this._in2 = this.inputs[2][0];
      this._in3 = this.inputs[2][0];
    };
    next[2][2][1][0] = next[2][2][1][1];
    next[2][2][0][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var inIn1 = this.inputs[1];
      var in23  = this._in2 + this._in3;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + inIn1[i  ] + in23;
        out[i+1] = inIn0[i+1] + inIn1[i+1] + in23;
        out[i+2] = inIn0[i+2] + inIn1[i+2] + in23;
        out[i+3] = inIn0[i+3] + inIn1[i+3] + in23;
        out[i+4] = inIn0[i+4] + inIn1[i+4] + in23;
        out[i+5] = inIn0[i+5] + inIn1[i+5] + in23;
        out[i+6] = inIn0[i+6] + inIn1[i+6] + in23;
        out[i+7] = inIn0[i+7] + inIn1[i+7] + in23;
      }
    };
    next[2][1][1][1] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var in123 = this._in1 + this._in2 + this._in3;
      var nextIn123 = this.inputs[1][0] + this.inputs[2][0] + this.inputs[3][0];
      var in123_slope = (nextIn123 - in123) * this.rate.slopeFactor;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + in123; in123 += in123_slope;
        out[i+1] = inIn0[i+1] + in123; in123 += in123_slope;
        out[i+2] = inIn0[i+2] + in123; in123 += in123_slope;
        out[i+3] = inIn0[i+3] + in123; in123 += in123_slope;
        out[i+4] = inIn0[i+4] + in123; in123 += in123_slope;
        out[i+5] = inIn0[i+5] + in123; in123 += in123_slope;
        out[i+6] = inIn0[i+6] + in123; in123 += in123_slope;
        out[i+7] = inIn0[i+7] + in123; in123 += in123_slope;
      }
      this._in1 = this.inputs[1][0];
      this._in2 = this.inputs[2][0];
      this._in3 = this.inputs[3][0];
    };
    next[2][1][1][0] = next[2][1][1][1];
    next[2][1][0][0] = next[2][1][1][1];
    next[2][0][0][0] = function(inNumSamples) {
      var out = this.outputs[0];
      var inIn0 = this.inputs[0];
      var in123 = this._in1 + this._in2 + this._in3;
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = inIn0[i  ] + in123;
        out[i+1] = inIn0[i+1] + in123;
        out[i+2] = inIn0[i+2] + in123;
        out[i+3] = inIn0[i+3] + in123;
        out[i+4] = inIn0[i+4] + in123;
        out[i+5] = inIn0[i+5] + in123;
        out[i+6] = inIn0[i+6] + in123;
        out[i+7] = inIn0[i+7] + in123;
      }
    };
    next[1][1][1][1] = function() {
      this.outputs[0][0] = this.inputs[0][0] + this.inputs[1][0] + this.inputs[2][0] + this.inputs[3][0];
    };
    next[1][1][1][0] = next[1][1][1][1];
    next[1][1][0][0] = next[1][1][1][1];
    next[1][0][0][0] = next[1][1][1][1];
    
    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/osc', function(require, exports, module) {

  var unit = require("./unit");
  var table = require("./table");
  
  var twopi = 2 * Math.PI;
  var kSineSize = table.kSineSize;
  var kSineMask = table.kSineMask;
  var gSineWavetable = table.gSineWavetable;
  
  unit.specs.SinOsc = (function() {
    var ctor = function() {
      this._freq  = this.inputs[0][0];
      this._phase = this.inputs[1][0];
      this._radtoinc = kSineSize / twopi;
      this._cpstoinc = kSineSize * this.rate.sampleDur;
      this._mask  = kSineMask;
      this._table = gSineWavetable;
      if (this.inRates[0] === 2) {
        if (this.inRates[1] === 2) {
          this.process = next_aa;
        } else if (this.inRates[1] === 1) {
          this.process = next_ak;
        } else {
          this.process = next_ai;
        }
        this._x = 0;
      } else {
        if (this.inRates[1] === 2) {
          this.process = next_ka;
          this._x = 0;
        } else {
          this.process = next_kk;
          this._x = this._phase * this._radtoinc;
        }
      }
      next_kk.call(this, 1);
    };
    var next_aa = function(inNumSamples) {
      var out = this.outputs[0];
      var freqIn  = this.inputs[0];
      var phaseIn = this.inputs[1];
      var mask  = this._mask;
      var table = this._table;
      var cpstoinc = this._cpstoinc;
      var radtoinc = this._radtoinc;
      var x = this._x, pphase, index, i;
      for (i = 0; i < inNumSamples; ++i) {
        pphase = x + radtoinc * phaseIn[i];
        index  = (pphase & mask) << 1;
        out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
        x += freqIn[i] * cpstoinc;
      }
      this._x = x;
    };
    var next_ak = function(inNumSamples) {
      var out = this.outputs[0];
      var freqIn    = this.inputs[0];
      var nextPhase = this.inputs[1][0];
      var mask  = this._mask;
      var table = this._table;
      var radtoinc = this._radtoinc;
      var cpstoinc = this._cpstoinc;
      var phase = this._phase;
      var x = this._x, pphase, index, i;
      if (nextPhase === phase) {
        phase *= radtoinc;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + phase;
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          x += freqIn[i] * cpstoinc;
        }
      } else {
        var phase_slope = (nextPhase - phase) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + radtoinc * phase;
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          phase += phase_slope;
          x += freqIn[i] * cpstoinc;
        }
        this._phase = nextPhase;
      }
      this._x = x;
    };
    var next_ai = function(inNumSamples) {
      var out = this.outputs[0];
      var freqIn = this.inputs[0];
      var phase  = this._phase * this._radtoinc;
      var mask  = this._mask;
      var table = this._table;
      var cpstoinc = this._cpstoinc;
      var x = this._x, pphase, index, i;
      for (i = 0; i < inNumSamples; ++i) {
        pphase = x + phase;
        index  = (pphase & mask) << 1;
        out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
        x += cpstoinc * freqIn[i];
      }
      this._x = x;
    };
    var next_ka = function(inNumSamples) {
      var out = this.outputs[0];
      var nextFreq = this.inputs[0][0];
      var phaseIn = this.inputs[1];
      var mask  = this._mask;
      var table = this._table;
      var radtoinc = this._radtoinc;
      var cpstoinc = this._cpstoinc;
      var freq = this._freq;
      var x = this._x, pphase, index, i;
      if (nextFreq === freq) {
        freq *= cpstoinc;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + radtoinc * phaseIn[i];
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          x += freq;
        }
      } else {
        var freq_slope = (nextFreq - freq) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + radtoinc * phaseIn[i];
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          x += freq * cpstoinc;
          freq += freq_slope;
        }
        this._freq = nextFreq;
      }
      this._x = x;
    };
    var next_kk = function(inNumSamples) {
      var out = this.outputs[0];
      var nextFreq  = this.inputs[0][0];
      var nextPhase = this.inputs[1][0];
      var mask  = this._mask;
      var table = this._table;
      var radtoinc = this._radtoinc;
      var cpstoinc = this._cpstoinc;
      var freq = this._freq;
      var phase = this._phase;
      var x = this._x, pphase, index, i;
      if (nextFreq === freq && nextPhase === phase) {
        freq  *= cpstoinc;
        phase *= radtoinc;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + phase;
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          x += freq;
        }
      } else {
        var freq_slope  = (nextFreq  - freq ) * this.rate.slopeFactor;
        var phase_slope = (nextPhase - phase) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          pphase = x + radtoinc * phase;
          index  = (pphase & mask) << 1;
          out[i] = table[index] + (pphase-(pphase|0)) * table[index+1];
          x += freq * cpstoinc;
          freq  += freq_slope;
          phase += phase_slope;
        }
        this._freq  = nextFreq;
        this._phase = nextPhase;
      }
      this._x = x;
    };
    
    return ctor;
  })();

  unit.specs.LFSaw = (function() {
    var ctor = function() {
      if (this.inRates[0] === 2) {
        this.process = next_a;
      } else {
        this.process = next_k;
      }
      this._cpstoinc = 2 * this.rate.sampleDur;
      this._phase    = this.inputs[1][0];
      this.process(1);
    };
    var next_a = function(inNumSamples) {
      var out = this.outputs[0];
      var freqIn   = this.inputs[0];
      var cpstoinc = this._cpstoinc;
      var phase    = this._phase;
      for (var i = 0; i < inNumSamples; ++i) {
        out[i] = phase;
        phase += freqIn[i] * cpstoinc;
        if (phase >= 1) {
          phase -= 2;
        } else if (phase <= -1) {
          phase += 2;
        }
      }
      this._phase = phase;
    };
    var next_k = function(inNumSamples) {
      var out = this.outputs[0];
      var freq = this.inputs[0][0] * this._cpstoinc;
      var phase = this._phase;
      var i;
      if (freq >= 0) {
        for (i = 0; i < inNumSamples; ++i) {
          out[i] = phase;
          phase += freq;
          if (phase >= 1) {
            phase -= 2;
          }
        }
      } else {
        for (i = 0; i < inNumSamples; ++i) {
          out[i] = phase;
          phase += freq;
          if (phase <= -1) {
            phase += 2;
          }
        }
      }
      this._phase = phase;
    };
    
    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/table', function(require, exports, module) {

  var twopi     = 2 * Math.PI;
  var kSineSize = 8192;
  var kSineMask = kSineSize - 1;
  var kBadValue = new Float32Array([1e20])[0];
  var gSine          = new Float32Array(kSineSize + 1);
  var gInvSine       = new Float32Array(kSineSize + 1);
  var gSineWavetable = new Float32Array(kSineSize * 2);
  (function() {
    var i;
    for (i = 0; i < kSineSize; ++i) {
      var d = Math.sin(twopi * (i / kSineSize));
      gSine[i] = d;
      gInvSine[i] = 1 / d;
    }
    gSine[kSineSize] = gSine[0];
    gInvSine[0] = gInvSine[kSineSize>>1] = gInvSine[kSineSize] = kBadValue;
    var sz = kSineSize, sz2 = sz >> 1;
    for (i = 1; i <= 8; ++i) {
      gInvSine[i] = gInvSine[sz-i] = gInvSine[sz2-i] = gInvSine[sz2+i] = kBadValue;
    }
  })();
  (function() {
    (function(signal, wavetable, inSize) {
      var val1, val2;
      var i, j;
      for (i = j = 0; i < inSize - 1; ++i) {
        val1 = signal[i];
        val2 = signal[i+1];
        wavetable[j++] = 2 * val1 - val2;
        wavetable[j++] = val2 - val1;
      }
      val1 = signal[inSize - 1];
      val2 = signal[0];
      wavetable[j++] = 2 * val1 - val2;
      wavetable[j++] = val2 - val1;
    })(gSine, gSineWavetable, kSineSize);
  })();
  
  module.exports = {
    kSineSize: kSineSize,
    kSineMask: kSineMask,
    gSine         : gSine,
    gInvSine      : gInvSine,
    gSineWavetable: gSineWavetable,
  };

});
define('cc/server/unit/pan', function(require, exports, module) {

  var unit = require("./unit");
  var table = require("./table");
  var gSine = table.gSine;

  unit.specs.Pan2 = (function() {
    var ctor = function() {
      if (this.inRates[1] === 2) {
        this.process = next_aa;
      } else {
        this.process = next_ak;
      }
      this._pos   = this.inputs[1][0];
      this._level = this.inputs[2][0];
      var ipos = (1024 * this._pos + 1024 + 0.5)|0;
      ipos = Math.max(0, Math.min(ipos, 2048));
      this._leftAmp  = this._level * gSine[2048 - ipos];
      this._rightAmp = this._level * gSine[ipos];
      next_aa.call(this, 1);
    };
    var next_ak = function(inNumSamples) {
      var leftOut  = this.outputs[0];
      var rightOut = this.outputs[1];
      var inIn  = this.inputs[0];
      var pos   = this.inputs[1][0];
      var level = this.inputs[2][0];
      var leftAmp  = this._leftAmp;
      var rightAmp = this._rightAmp;
      var i, _in;
      if (pos !== this._pos || level !== this._level) {
        var ipos = (1024 * pos + 1024 + 0.5)|0;
        ipos = Math.max(0, Math.min(ipos, 2048));
        var nextLeftAmp  = level * gSine[2048 - ipos];
        var nextRightAmp = level * gSine[ipos];
        var slopeFactor = this.rate.slopeFactor;
        var leftAmp_slope  = (nextLeftAmp  - leftAmp ) * slopeFactor;
        var rightAmp_slope = (nextRightAmp - rightAmp) * slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          _in = inIn[i];
          leftOut[i]  = _in * leftAmp;
          rightOut[i] = _in * rightAmp;
          leftAmp  += leftAmp_slope;
          rightAmp += rightAmp_slope;
        }
        this._pos = pos;
        this._level = level;
        this._leftAmp  = nextLeftAmp;
        this._rightAmp = nextRightAmp;
      } else {
        for (i = 0; i < inNumSamples; ++i) {
          _in = inIn[i];
          leftOut[i]  = _in * leftAmp;
          rightOut[i] = _in * rightAmp;
        }
      }
    };
    var next_aa = function(inNumSamples) {
      var leftOut  = this.outputs[0];
      var rightOut = this.outputs[1];
      var inIn  = this.inputs[0];
      var posIn = this.inputs[1];
      var nextLevel = this.inputs[2][0];
      var level = this._level;
      var i, _in, ipos, leftAmp, rightAmp;
      if (level !== nextLevel) {
        var level_slope = (nextLevel - level) * this.rate.slopeFactor;
        for (i = 0; i < inNumSamples; ++i) {
          ipos = (1024 * posIn[i] + 1024 + 0.5)|0;
          ipos = Math.max(0, Math.min(ipos, 2048));
          leftAmp  = level * gSine[2048 - ipos];
          rightAmp = level * gSine[ipos];
          _in = inIn[i];
          leftOut[i]  = _in * leftAmp;
          rightOut[i] = _in * rightAmp;
          level += level_slope;
        }
        this._level = nextLevel;
      } else {
        for (i = 0; i < inNumSamples; ++i) {
          ipos = (1024 * posIn[i] + 1024 + 0.5)|0;
          ipos = Math.max(0, Math.min(ipos, 2048));
          leftAmp  = level * gSine[2048 - ipos];
          rightAmp = level * gSine[ipos];
          _in = inIn[i];
          leftOut[i]  = _in * leftAmp;
          rightOut[i] = _in * rightAmp;
        }
      }
    };

    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/ui', function(require, exports, module) {

  var unit = require("./unit");
  
  var log001 = Math.log(0.001);

  unit.specs.MouseX = (function() {
    var ctor = function() {
      this.process = next_kkkk;
      this._y1  = 0;
      this._b1  = 0;
      this._lag = 0;
      this.process(1);
    };
    var next_kkkk = function(inNumSamples, instance) {
      var minval = this.inputs[0][0] || 0.01;
      var maxval = this.inputs[1][0];
      var warp   = this.inputs[2][0];
      var lag    = this.inputs[3][0];
      var y1 = this._y1;
      var b1 = this._b1;
      if (lag !== this._lag) {
        this._b1  = lag === 0 ? 0 : Math.exp(log001 / (lag * this.rate.sampleRate));
        this._lag = lag;
      }
      var y0 = instance ? instance.f32_syncItems[1] : 0;
      if (warp === 0) {
        y0 = (maxval - minval) * y0 + minval;
      } else {
        y0 = Math.pow(maxval / minval, y0) * minval;
        if (isNaN(y0)) { y0 = 0; }
      }
      this.outputs[0][0] = y1 = y0 + b1 * (y1 - y0);
      this._y1 = y1;
    };
    return ctor;
  })();

  unit.specs.MouseY = (function() {
    var ctor = function() {
      this.process = next_kkkk;
      this._y1  = 0;
      this._b1  = 0;
      this._lag = 0;
      this.process(1);
    };
    var next_kkkk = function(inNumSamples, instance) {
      var minval = this.inputs[0][0] || 0.01;
      var maxval = this.inputs[1][0];
      var warp   = this.inputs[2][0];
      var lag    = this.inputs[3][0];
      var y1 = this._y1;
      var b1 = this._b1;
      if (lag !== this._lag) {
        this._b1  = lag === 0 ? 0 : Math.exp(log001 / (lag * this.rate.sampleRate));
        this._lag = lag;
      }
      var y0 = instance ? instance.f32_syncItems[2] : 0;
      if (warp === 0) {
        y0 = (maxval - minval) * y0 + minval;
      } else {
        y0 = Math.pow(maxval / minval, y0) * minval;
        if (isNaN(y0)) { y0 = 0; }
      }
      this.outputs[0][0] = y1 = y0 + b1 * (y1 - y0);
      this._y1 = y1;
    };
    return ctor;
  })();

  unit.specs.MouseButton = (function() {
    var ctor = function() {
      this.process = next_kkk;
      this._y1  = 0;
      this._b1  = 0;
      this._lag = 0;
      this.process(1);
    };
    var next_kkk = function(inNumSamples, instance) {
      var minval = this.inputs[0][0];
      var maxval = this.inputs[1][0];
      var lag    = this.inputs[2][0];
      var y1 = this._y1;
      var b1 = this._b1;
      if (lag !== this._lag) {
        this._b1  = lag === 0 ? 0 : Math.exp(log001 / (lag * this.rate.sampleRate));
        this._lag = lag;
      }
      var y0 = instance ? (instance.syncItems[3] ? maxval : minval) : minval;
      this.outputs[0][0] = y1 = y0 + b1 * (y1 - y0);
      this._y1 = y1;
    };
    return ctor;
  })();
  
  module.exports = {};

});
define('cc/server/unit/uop', function(require, exports, module) {

  var unit = require("./unit");
  var ops  = require("../../common/ops");
  
  var calcFunc = {};
  
  unit.specs.UnaryOpUGen = (function() {
    
    var ctor = function() {
      var func = calcFunc[ops.UNARY_OP_UGEN_MAP[this.specialIndex]];
      var process;
      if (func) {
        switch (this.inRates[0]) {
        case 2  : process = func.a; break;
        case 1: process = func.k; break;
        }
        this.process = process;
        if (this.process) {
          this.process(1);
        } else {
          this.outputs[0][0] = func(this.inputs[0][0]);
        }
      } else {
        console.log("UnaryOpUGen[" + this.specialIndex + "] is not defined.");
      }
    };
    
    return ctor;
  })();
  
  var unary_k = function(func) {
    return function() {
      this.outputs[0][0] = func(this.inputs[0][0]);
    };
  };
  var unary_a = function(func) {
    return function(inNumSamples) {
      var out = this.outputs[0];
      var a = this.inputs[0];
      for (var i = 0; i < inNumSamples; i += 8) {
        out[i  ] = func(a[i  ]); out[i+1] = func(a[i+1]);
        out[i+2] = func(a[i+2]); out[i+3] = func(a[i+3]);
        out[i+4] = func(a[i+4]); out[i+5] = func(a[i+5]);
        out[i+6] = func(a[i+6]); out[i+7] = func(a[i+7]);
      }
    };
  };
  
  var avoidzero = function(a) {
    if (-1e-6 < a && a < 0) {
      a = -1e-6;
    }
    if (0 <= a && a < +1e-6) {
      a = +1e-6;
    }
    return a;
  };
  
  calcFunc.neg = function(a) {
    return -a;
  };
  calcFunc.not = function(a) {
    return a === 0 ? 1 : 0;
  };
  calcFunc.abs = function(a) {
    return Math.abs(a);
  };
  calcFunc.ceil = function(a) {
    return Math.ceil(a);
  };
  calcFunc.floor = function(a) {
    return Math.floor(a);
  };
  calcFunc.frac = function(a) {
    if (a < 0) {
      return 1 + (a - (a|0));
    }
    return a - (a|0);
  };
  calcFunc.sign = function(a) {
    if (a === 0) {
      return 0;
    } else if (a > 0) {
      return 1;
    }
    return -1;
  };
  calcFunc.squared = function(a) {
    return a * a;
  };
  calcFunc.cubed = function(a) {
    return a * a * a;
  };
  calcFunc.sqrt = function(a) {
    return Math.sqrt(Math.abs(a));
  };
  calcFunc.exp = function(a) {
    return Math.exp(a);
  };
  calcFunc.reciprocal = function(a) {
    return 1 / avoidzero(a);
  };
  calcFunc.midicps = function(a) {
    return 440 * Math.pow(2, (a - 69) * 1/12);
  };
  calcFunc.cpsmidi = function(a) {
    return Math.log(Math.abs(avoidzero(a)) * 1/440) * Math.LOG2E * 12 + 69;
  };
  calcFunc.midiratio = function(a) {
    return Math.pow(2, a * 1/12);
  };
  calcFunc.ratiomidi = function(a) {
    return Math.log(Math.abs(avoidzero(a))) * Math.LOG2E * 12;
  };
  calcFunc.dbamp = function(a) {
    return Math.pow(10, a * 0.05);
  };
  calcFunc.ampdb = function(a) {
    return Math.log(Math.abs(avoidzero(a))) * Math.LOG10E * 20;
  };
  calcFunc.octcps = function(a) {
    return 440 * Math.pow(2, avoidzero(a) - 4.75);
  };
  calcFunc.cpsoct = function(a) {
    return Math.log(Math.abs(a) * 1/440) * Math.LOG2E + 4.75;
  };
  calcFunc.log = function(a) {
    return Math.log(Math.abs(avoidzero(a)));
  };
  calcFunc.log2 = function(a) {
    return Math.log2(Math.abs(avoidzero(a))) * Math.LOG2E;
  };
  calcFunc.log10 = function(a) {
    return Math.log2(Math.abs(avoidzero(a))) * Math.LOG10E;
  };
  calcFunc.sin = function(a) {
    return Math.sin(a);
  };
  calcFunc.cos = function(a) {
    return Math.cos(a);
  };
  calcFunc.tan = function(a) {
    return Math.tan(a);
  };
  calcFunc.asin = function(a) {
    return Math.asin(Math.max(-1, Math.min(a, 1)));
  };
  calcFunc.acos = function(a) {
    return Math.acos(Math.max(-1, Math.min(a, 1)));
  };
  calcFunc.atan = function(a) {
    return Math.atan(a);
  };
  calcFunc.sinh = function(a) {
    return (Math.pow(Math.E, a) - Math.pow(Math.E, -a)) * 0.5;
  };
  calcFunc.cosh = function(a) {
    return (Math.pow(Math.E, a) + Math.pow(Math.E, -a)) * 0.5;
  };
  calcFunc.tanh = function(a) {
    var sinh = (Math.pow(Math.E, a) - Math.pow(Math.E, -a)) * 0.5;
    var cosh = (Math.pow(Math.E, a) + Math.pow(Math.E, -a)) * 0.5;
    return sinh / cosh;
  };
  calcFunc.rand = function(a) {
    return Math.random() * a;
  };
  calcFunc.rand2 = function(a) {
    return (Math.random() * 2 - 1) * a;
  };
  calcFunc.linrand = function(a) {
    return Math.min(Math.random(), Math.random()) * a;
  };
  calcFunc.bilinrand = function(a) {
    return (Math.random() - Math.random()) * a;
  };
  calcFunc.sum3rand = function(a) {
    return (Math.random() + Math.random() + Math.random() - 1.5) * 0.666666667 * a;
  };
  calcFunc.distort = function(a) {
    return a / (1 + Math.abs(a));
  };
  calcFunc.softclip = function(a) {
    var absa = Math.abs(a);
    return absa <= 0.5 ? a : (absa - 0.25) / a;
  };
  calcFunc.coin = function(a) {
    return Math.random() < a ? 1 : 0;
  };
  calcFunc.num = function(a) {
    return +a;
  };
  calcFunc.tilde = function(a) {
    return ~a;
  };
  calcFunc.num = function(a) {
    return a;
  };
  calcFunc.pi = function(a) {
    return Math.PI * a;
  };
  
  Object.keys(calcFunc).forEach(function(key) {
    var func = calcFunc[key];
    if (!func.a) { func.a = unary_a(func); }
    if (!func.k) { func.k = unary_k(func); }
  });
  
  module.exports = {};

});
var exports = _require("cc/cc", "cc/loader");
if (typeof module !== "undefined") {
  module.exports = exports;
}
})(this.self||global);
