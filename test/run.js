var assert = require("assert");
var main = require("../ensure");

describe("install", function () {
  it("binds this to global", function () {
    main.makeInstaller()({
      "index.js": function () {
        assert.strictEqual(
          Object.prototype.toString.call(this),
          "[object global]"
        );
      }
    })(".");
  });

  it("permits synchronous require", function () {
    var install = main.makeInstaller();

    var require = install({
      "foo.js": function (require, exports, module) {
        assert.strictEqual(typeof module, "object");
        assert.strictEqual(require(module.id), exports);
        module.exports = require("asdf");
        assert.strictEqual(require(module.id), module.exports);
      },
      node_modules: {
        asdf: {
          "package.json": function (require, exports, module) {
            exports.main = "./lib";
            assert.strictEqual(require(module.id), exports);
          },
          lib: {
            "index.js": function (require, exports, module) {
              exports.asdfMain = true;
              assert.strictEqual(require(module.id), exports);
            }
          }
        }
      }
    });

    assert.deepEqual(require("./foo"), {
      asdfMain: true
    });

    assert.deepEqual(require("asdf"), {
      asdfMain: true
    });

    assert.strictEqual(require("./foo"), require("./foo.js"));
  });

  it("supports a variety of relative identifiers", function () {
    var install = main.makeInstaller();
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
      assert.strictEqual(require("./o/index").value, value);
      assert.strictEqual(require("./o/index.js").value, value);
    }

    install({
      path: {
        to: {
          "n.js": n,
          o: {
            "index.js": function(r, exports) {
              exports.value = value;
            }
          }
        }
      }
    })("./path/to/n");
  });

  it("permits asynchronous require", function (done) {
    var install = main.makeInstaller({
      defer: process.nextTick
    });

    var order = [];

    // Calling install with an array of module identifiers and a
    // module factory function registers that module as an entry point
    // that should be evaluated once all of its depedencies have been
    // installed. Note that those dependencies may not have been evaluated
    // before this module is evaluated.

    install().ensure([
      "./dep1" // Unmet dependency.
    ], function (require) {
      order.push("root");
      var dep1 = require("./dep1");
      assert.deepEqual(dep1, { dep2: true });
      assert.deepEqual(order, ["package.json", "root", "dep2"]);
      assert.deepEqual(require("./dep1/dep3"), { dep3: true });
      assert.deepEqual(order, ["package.json", "root", "dep2", "dep3"]);
      done();
    });

    install({
      dep1: {
        "package.json": function (require, exports) {
          order.push("package.json");
          exports.main = "./dep2";
        },
        "dep2.json": [
          "./dep2", // Self dependency.
          "./dep3", // Unmet dependency.
          function (require, exports) {
            order.push("dep2");
            exports.dep2 = true;
          }
        ]
      }
    });

    install({
      dep1: {
        "dep3.js": function (require, exports, module) {
          order.push("dep3");
          exports.dep3 = true;
        }
      }
    });
  });

  it("supports global modules", function () {
    var install = main.makeInstaller();

    install({
      node_modules: {
        glob: {
          "package.json": function (r, exports) {
            exports.main = "glob.js";
          },
          "glob.js": function (r, exports) {
            exports.glob = "global glob";
          }
        },
        "assert.js": function (r, exports) {
          exports.assert = "global assert";
        }
      }
    });

    install({
      app: {
        "index1.js": function (require) {
          assert.deepEqual(require("glob"), { glob: "global glob" });
          assert.deepEqual(require("assert"), { assert: "global assert" });
        }
      }
    })("./app/index1");

    install({
      app: {
        node_modules: {
          glob: {
            "index.js": function (r, exports) {
              exports.glob = "local glob";
            }
          }
        },
        "index2.js": function (require) {
          assert.deepEqual(require("glob"), { glob: "local glob" });
          assert.deepEqual(require("assert"), { assert: "global assert" });
        }
      }
    })("./app/index2");
  });

  it("allows asynchronous packages", function (done) {
    var install = main.makeInstaller();

    install({
      node_modules: {
        testPackage1: {
          "index.js": function (r, exports) {
            exports.testPackage = 1;
          }
        }
      }
    }).ensure([
      "testPackage1", // Met dependency.
      "testPackage2", // Unmet dependency.
    ], function (require, exports) {
      assert.deepEqual(require("testPackage1"), {
        testPackage: 1
      });

      assert.deepEqual(require("testPackage2"), {
        testPackage: 2
      });

      require.ensure(
        "testPackage2",
        function (require) {
          assert.deepEqual(require("testPackage1"), {
            testPackage: 1
          });

          done();
        }
      );
    });

    // Finally, turn testPackage2 into a valid package by adding an
    // index.js file.
    install({
      node_modules: {
        testPackage2: {
          "index.js": function (r, exports) {
            exports.testPackage = 2;
          }
        }
      }
    });
  });

  it("allows any value for module.exports", function () {
    var obj = {};
    var fun = function () {};

    var require = main.makeInstaller()({
      "object": function (r, e, module) {
        module.exports = obj;
      },

      "function": function (r, e, module) {
        module.exports = fun;
      },

      "false": function (r, e, module) {
        module.exports = false;
      },

      "null": function (r, e, module) {
        module.exports = null;
      },

      "undefined": function (r, e, module) {
        var undef;
        module.exports = undef;
      }
    });

    assert.strictEqual(require("./object"), obj);
    assert.strictEqual(require("./function"), fun);
    assert.strictEqual(require("./false"), false);
    assert.strictEqual(require("./null"), null);
    assert.strictEqual(require("./undefined"), void(0));
  });

  it("copes with long dependency chains", function (done) {
    var n = 500;
    var count = 0;
    var install = main.makeInstaller({
      defer: setImmediate
    });

    for (var i = 1; i <= n; ++i) {
      (function (i, tree) {
        var array = tree["m" + i] = [];

        // Everything depends on everything else.
        for (var j = n - 1; j >= 0; --j) {
          array.push("./m" + j);
        }

        array.push(function module(require, exports) {
          exports.value = 1 + require("./m" + (i - 1)).value;
        });

        install(tree);
      })(i, {});
    }

    var lastId = "./m" + (i - 1);
    install().ensure(lastId, function (require) {
      assert.strictEqual(n, require(lastId).value);
      done();
    });

    install({
      m0: function (require, exports) {
        exports.value = 0;
      }
    });
  });

  it("prefers fuzzy files to exact directories", function () {
    var install = main.makeInstaller();
    var require = install({
      "node_modules": {
        "foo.js": function (r, exports) {
          exports.file = true;
        },
        "foo": {
          "index.js": function (require, exports) {
            exports.directory = true;
            assert.deepEqual(require("foo"), { file: true });
          }
        }
      }
    });

    assert.deepEqual(require("foo.js"), { file: true });
    assert.deepEqual(require("foo"), { file: true });
    assert.deepEqual(require("foo/"), { directory: true });
    assert.deepEqual(require("foo/."), { directory: true });
    assert.deepEqual(require("foo/index"), { directory: true });

    assert.deepEqual(require("./node_modules/foo.js"), { file: true });
    assert.deepEqual(require("./node_modules/foo"), { file: true });
    assert.deepEqual(require("./node_modules/foo/"), { directory: true });
    assert.deepEqual(require("./node_modules/foo/."), { directory: true });
    assert.deepEqual(require("./node_modules/foo/index"), { directory: true });
  });
});
