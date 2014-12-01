var assert = require("assert");
var main = require("../main");
main.makeGlobal();

function finish(done) {
  process.nextTick(done);
}

describe("install API", function() {
  it("basic", function(done) {
    assert.strictEqual(typeof install, "function");
    finish(done);
  });

  it("named module", function(done) {
    install("a", function(require, exports, module) {
      exports.upperCode = module.id.toUpperCase().charCodeAt(0);
    });

    install(function(require) {
      assert.strictEqual(require("a").upperCode, "A".charCodeAt(0));
      finish(done);
    });
  });

  it("single evaluation", function(done) {
    var count = 0;

    install(function(require) {
      assert.strictEqual(count, 0);
      require("b");
      assert.strictEqual(count, 1);
    });

    assert.strictEqual(count, 0);

    install(function(require) {
      assert.strictEqual(count, 1);
      require("b");
      assert.strictEqual(count, 1);
      finish(done);
    });

    assert.strictEqual(count, 0);

    install("b", function() {
      assert.strictEqual(count, 0);
      count += 1;
    });
  });

  it("transitive deps", function(done) {
    var ids = [];

    install(function(require) {
      assert.strictEqual(ids.length, 0);
      require("c");
      assert.strictEqual(ids.join(""), "cde");
      finish(done);
    });

    install("c", function(require) {
      ids.push("c");
      require("d");
    });

    install("d", function(require) {
      ids.push("d");
      require("e");
    });

    assert.strictEqual(ids.length, 0);

    install("e", function() {
      ids.push("e");
    });
  });

  it("dynamic non-evaluation", function(done) {
    var evaluated = false;

    install(function(require) {
      evaluated = true;
      if (!evaluated) {
        require("g");
        assert.ok(false, "not reached");
      }
      finish(done);
    });

    assert.ok(!evaluated, "should not have run yet");

    install("g", function() {
      assert.ok(false, "not reached");
    });
  });

  it("literal style", function(done) {
    var fExp = { a: "sdf", foo: 42 };

    install(function(require) {
      assert.deepEqual(require("f"), fExp);
      assert.strictEqual(require("f"), fExp);
      finish(done);
    });

    install("f", { exports: fExp });
  });

  it("call method style", function(done) {
    var h;
    install("h", h = {
      code: "exports.bar = require('i').foo",
      toString: function() { return this.code },
      call: function(self, require, exports) {
        Function("require,exports", this.code)(require, exports);
      }
    });

    install(function(require) {
      assert.strictEqual(require("h").bar, 42);
      finish(done);
    });

    install("i", { exports: { foo: 42 }});
  });

  it("deps style", function(done) {
    function uselessToString() {
      assert.ok(false, ".toString should not be called when .deps is defined");
    }

    install("h2", {
      deps: { h0: true, h1: true },
      toString: uselessToString,

      call: function(self, require, exports, module) {
        function checkName(id) {
          assert.strictEqual(require(id).name, id);
        }

        exports.name = module.id;

        checkName("h0");
        checkName("h1");
        checkName("h2");
      }
    });

    install("h1", { exports: { name: "h1" }});

    install({
      deps: { h2: true },
      toString: uselessToString,
      call: function(self, require) {
        var h2 = "h2";
        assert.strictEqual(require(h2).name, "h2");
        finish(done);
      }
    });

    install("h0", function(require, exports) {
      exports.name = "h0";
    });
  });

  it("circular requirement", function(done) {
    install("j", function(require, exports) {
      var k = require("k");
      assert.strictEqual(k.foo, 42);
      exports.bar = k.foo * 2;
    });

    install("k", function(require, exports) {
      exports.foo = 42;
      var j = require("j");
      exports.foo += 1;
    });

    install(function(require) {
      assert.strictEqual(require("k").foo, 43);
      assert.strictEqual(require("j").bar, 84);
    });

    install(function(require) {
      assert.strictEqual(require("j").bar, 84);
      assert.strictEqual(require("k").foo, 43);
      finish(done);
    });
  });

  it("exception", function(done) {
    var error = new Error("whoaaa");
    var str = "";

    install(function() {
      str += "a";
      assert.strictEqual(str, "a");
    });

    install(function(require) {
      require("l");
      str += "b";
      assert.strictEqual(str, "ab");
      throw error;
    });

    install(function() {
      str += "c";
    });

    install(function() {
      assert.strictEqual(str, "abc");
      finish(done);
    });

    try {
      assert.strictEqual(str, "a");
      install("l", function(){});
    } catch (x) {
      assert.strictEqual(x, error);
    }

    assert.strictEqual(str, "ab");
  });

  it("very long queue", function(done) {
    var n = 1000;
    var count = 0;

    function tick(require) {
      count += require("m").one;
    }

    while (n --> 0)
      install(tick);

    install(function() {
      assert.strictEqual(count, 1000);
      finish(done);
    });

    install("m", { exports: { one: 1 } });
  });

  it("relative require", function(done) {
    var value = {};

    function n(require, exports) {
      assert.strictEqual(require("./o").value, value);
      assert.strictEqual(require("../to/o").value, value);
      assert.strictEqual(require("../../path/to/o").value, value);
      assert.strictEqual(require("..//.././path/to/o").value, value);
      assert.strictEqual(require(".././.././path/to/o").value, value);
      assert.strictEqual(require("../..//path/to/o").value, value);
      assert.strictEqual(require("../..//path/./to/o").value, value);
      assert.strictEqual(require("../..//path/./to/../to/o").value, value);
      assert.strictEqual(require("../to/../to/o").value, value);
      assert.strictEqual(require("../to/../../path/to/o").value, value);

      assert.deepEqual(
        main.getRequiredIDs("path/to/n", n.toString()),
        ["path/to/o"]);

      finish(done);
    }

    install("path/to/n", n);

    install("path/to/o", function(require, exports) {
      exports.value = value;
    });

    install(function(require) {
      require("path/to/n");
    });
  });

  it("redefine module exports", function(done) {
    var obj = {};
    var fun = function(){};

    install("n-obj", function(require, exports, module) {
      module.exports = obj;
    });

    install("n-fun", function(require, exports, module) {
      module.exports = fun;
    });

    install("n-false", function(require, exports, module) {
      module.exports = false;
    });

    install("n-null", function(require, exports, module) {
      module.exports = null;
    });

    install("n-undef", function(require, exports, module) {
      var undef;
      module.exports = undef;
    });

    install(function(require) {
      assert.strictEqual(require("n-obj"), obj);
      assert.strictEqual(require("n-fun"), fun);
      assert.strictEqual(require("n-false"), false);
      assert.strictEqual(require("n-null"), null);
      assert.strictEqual(require("n-undef"), void(0));
      finish(done);
    });
  });

  it("getCode", function(done) {
    main.getCode(function(err, code) {
      assert.equal(err, null);
      assert.notEqual(code.indexOf("install"), -1);
      assert.strictEqual(code, main.getCodeSync());

      finish(done);
    });
  });

  it("renameCode", function(done) {
    main.renameCode("iginstall", function(err, code) {
      assert.equal(err, null);
      assert.notEqual(code.indexOf("iginstall"), -1);
      assert.strictEqual(code, main.renameCodeSync("iginstall"));

      finish(done);
    });
  });
});
