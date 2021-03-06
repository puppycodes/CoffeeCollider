define(function(require, exports, module) {
  "use strict";

  var assert = require("chai").assert;
  var testTools = require("../../testTools");
  var ugenTestSuite = testTools.ugenTestSuite;
  var unitTestSuite = testTools.unitTestSuite;
  
  var cc = require("../cc")
  var ugen = require("../lang/ugen");
  var unit = require("../server/unit");
  var line = require("./line");
  
  describe("plugins/line.js", function() {
    ugenTestSuite("Line", {
      ar: ["start",0, "end",1, "dur",1, "-mul",1, "-add",0, "doneAction",0],
      kr: ["start",0, "end",1, "dur",1, "-mul",1, "-add",0, "doneAction",0],
    }).unitTestSuite([
      { rate  : C.CONTROL,
        inputs: [
          { name:"start"     , value:0.01 },
          { name:"end"       , value:1    },
          { name:"dur"       , value:1    },
          { name:"doneAction", value:0    },
        ]
      },
      { rate  : C.CONTROL,
        inputs: [
          { name:"start"     , value:0.01 },
          { name:"end"       , value:1    },
          { name:"dur"       , value:0    },
          { name:"doneAction", value:0    },
        ]
      }
    ], {
      checker: function(statistics) {
        // console.log(statistics);
        assert.isFalse(statistics.hasNaN);
        assert.ok(statistics.min >= -1.0);
        assert.ok(statistics.max <= +1.0);
      }
    });
    
    ugenTestSuite("XLine", {
      ar: ["start",1, "end",2, "dur",1, "-mul",1, "-add",0, "doneAction",0],
      kr: ["start",1, "end",2, "dur",1, "-mul",1, "-add",0, "doneAction",0],
    }).unitTestSuite([
      { rate  : C.CONTROL,
        inputs: [
          { name:"start"     , value:0.01 },
          { name:"end"       , value:1    },
          { name:"dur"       , value:1    },
          { name:"doneAction", value:0    },
        ]
      },
      { rate  : C.CONTROL,
        inputs: [
          { name:"start"     , value:0.01 },
          { name:"end"       , value:1    },
          { name:"dur"       , value:0    },
          { name:"doneAction", value:0    },
        ]
      }
    ], {
      checker: function(statistics) {
        // console.log(statistics);
        assert.isFalse(statistics.hasNaN);
        assert.ok(statistics.min >= -1.0);
        assert.ok(statistics.max <= +1.0);
      }
    });
  });

});
