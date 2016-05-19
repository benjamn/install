var assert = require("assert");
var main = require("../install.js");
var reify = require("reify/lib/runtime").enable;

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

  it("copes with long dependency chains", function () {
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

    var require = install({
      m0: function (require, exports) {
        exports.value = 0;
      }
    });

    var lastId = "./m" + (i - 1);
    assert.strictEqual(require(lastId).value, n);
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

  it("supports options.fallback", function (done) {
    var unknown = {};

    var install = main.makeInstaller({
      fallback: function (id, parentId, error) {
        assert.strictEqual(id, "unknown-module");
        assert.strictEqual(parentId, "/foo/bar/parent.js");
        assert.ok(error instanceof Error);
        return unknown;
      }
    });

    var require = install({
      foo: {
        bar: {
          "parent.js": function (require) {
            assert.strictEqual(
              require("unknown-module"),
              unknown
            );

            done();
          }
        }
      }
    });

    require("./foo/bar/parent");
  });

  it("supports symbolic links", function () {
    var install = main.makeInstaller();
    var require = install({
      a: "./dir/c",
      dir: {
        b: "./c",
        c: function (require, exports, module) {
          exports.id = module.id;
        },
        d: "e",
        node_modules: {
          "e.js": ["f", function (require, exports, module) {
            exports.id = module.id;
          }]
        }
      }
    });

    var a = require("./a");
    var b = require("./dir/b");
    var c = require("./dir/c");

    assert.strictEqual(a, c);
    assert.strictEqual(b, c);
    assert.strictEqual(c.id, "/dir/c");

    install({
      dir: {
        node_modules: {
          f: {
            // Because there is no index.js or package.json, the f package
            // should still not be ready.
          }
        }
      }
    });

    install({
      dir: {
        node_modules: {
          f: {
            "index.js": function() {}
          }
        }
      }
    });

    assert.strictEqual(require("./dir/d").id, "/dir/node_modules/e.js");
    assert.strictEqual(
      require.resolve("./dir/d"),
      "/dir/node_modules/e.js"
    );
  });

  it("avoids circular package.json resolution chains", function () {
    main.makeInstaller()({
      // Module a imports package b, whose package.json file delegates to
      // package c, whose package.json file delegates to c's own
      // directory, which contains an index.js file symbolically linked
      // back to package b, whose index.js file takes precedence over
      // package.json because we already examined b's package.json file.

      a: function (require) {
        assert.strictEqual(require("b").name, "/node_modules/b/index.js");
      },

      node_modules: {
        b: {
          "package.json": function (r, exports) {
            exports.main = "c";
          },

          "index.js": function (r, exports, module) {
            exports.name = module.id;
          }
        },

        c: {
          "package.json": function (r, exports) {
            exports.main = ".";
          },

          "index.js": "b"
        }
      }
    })("./a");
  });

  it("provides __filename and __dirname", function (done) {
    var require = main.makeInstaller()({
      a: {
        b: {
          "c.js": function (r, e, m, __filename, __dirname) {
            assert.strictEqual(__filename, "/a/b/c.js");
            assert.strictEqual(__dirname, "/a/b");
            done();
          }
        }
      },

      "d.js": function (r, e, m, __filename, __dirname) {
        assert.strictEqual(__filename, "/d.js");
        assert.strictEqual(__dirname, "/");
      }
    });

    require("./a/b/c");
    require("./d");
  });

  it("allows alternate extensions", function (done) {
    main.makeInstaller()({
      "a.js": function (require) {
        assert.strictEqual(require("./b").name, "/b.foo");
        assert.strictEqual(require("/b").name, "/b.foo");
        done();
      },

      "b.foo": function (r, exports, module) {
        exports.name = module.id;
      }
    }, {
      extensions: [".js", ".json", ".foo"]
    })("./a");
  });

  it("allows package overrides and fallbacks", function () {
    var install = main.makeInstaller({
      override: function (id, parentId) {
        assert.strictEqual(parentId, "/parent.js");

        var parts = id.split("/");

        if (parts[0] === "forbidden") {
          return false;
        }

        if (parts[0] === "overridden") {
          parts[0] = "alternate";
          return parts.join("/");
        }

        return id;
      },

      fallback: function (id, parentId, error) {
        assert.strictEqual(id, "forbidden");
        assert.strictEqual(parentId, "/parent.js");
        throw error;
      }
    });

    var require = install({
      "parent.js": ["forbidden", "overridden", "alternate", function (require, exports, module) {
        var error;
        try {
          require("forbidden");
        } catch (e) {
          error = e;
        }
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, "Cannot find module 'forbidden'");

        assert.strictEqual(
          require("overridden").name,
          "/node_modules/alternate/index.js"
        );

        assert.strictEqual(
          require("overridden/index").name,
          "/node_modules/alternate/index.js"
        );

        assert.strictEqual(
          require("alternate").name,
          "/node_modules/alternate/index.js"
        );

        assert.strictEqual(
          require(module.id),
          exports
        );
      }],

      node_modules: {
        "forbidden": {
          "index.js": function () {
            throw new Error("package should have been forbidden");
          }
        },

        "alternate": {
          "index.js": function (require, exports, module) {
            exports.name = module.id;
          }
        }
      }
    });

    require("./parent");
  });

  it("allows global installation", function () {
    var install = main.makeInstaller();

    var require = install({
      node_modules: {
        a: {
          "index.js": function (r, exports) {
            exports.value = "normal";
          }
        }
      },

      "..": {
        node_modules: {
          "a.js": function (r, exports) {
            exports.value = "global";
          }
        }
      }
    });

    assert.strictEqual(require("a").value, "normal");
    assert.strictEqual(require("a.js").value, "global");
    assert.strictEqual(
      require.resolve("a.js"),
      "/../node_modules/a.js"
    );
  });

  it("supports module.parent", function (done) {
    var install = main.makeInstaller();
    var require = install({
      a: function (require, exports, module) {
        assert.strictEqual(module.parent.id, "/");
        assert.strictEqual(typeof module.parent.parent, "undefined");
        require("b");
      },

      node_modules: {
        b: {
          "index.js": function (require, exports, module) {
            assert.strictEqual(module.parent.id, "/a");
            require("c");
          }
        },

        c: {
          "package.json": function (require, exports, module) {
            exports.main = "final.js";
          },

          "final.js": function (require, exports, module) {
            assert.strictEqual(module.parent.id, "/node_modules/b/index.js");
            assert.strictEqual(module.parent.parent.id, "/a");
            done();
          }
        }
      }
    });

    require("./a");
  });

  it("respects Module.prototype.useNode", function () {
    var install = main.makeInstaller();

    install.Module.prototype.useNode = function () {
      if (this.id.split("/").pop() === "b") {
        assert.strictEqual(typeof this.exports, "undefined");
        this.exports = {
          usedNode: true
        };
        return true;
      }
    };

    var require = install({
      a: function (require, exports) {
        exports.b = require("./b");
      },

      b: function (r, exports) {
        exports.usedNode = false;
      }
    });

    assert.strictEqual(require("./a").b.usedNode, true);
    assert.strictEqual(require("./b").usedNode, true);
    assert.strictEqual(require("./a").b, require("./b"));
  });

  it("runs setters", function () {
    var install = main.makeInstaller();

    // Enable Module.prototype.{import,export}.
    reify(install.Module);

    var markers = [];

    var require = install({
      a: function (r, exports, module) {
        exports.one = 1;

        module.import("./b", {
          one: function (v) {
            markers.push("ab1", v);
          },

          two: function (v) {
            markers.push("ab2", v);
          }
        });

        exports.two = 2;
      },

      b: function (r, exports, module) {
        exports.one = 1;

        module.import("./a", {
          one: function (v) {
            markers.push("ba1", v);
          },

          two: function (v) {
            markers.push("ba2", v);
          }
        });

        exports.two = 2;
      }
    });

    assert.deepEqual(require("./a"), {
      one: 1,
      two: 2
    });

    assert.deepEqual(markers, [
      "ba1", 1,
      "ba2", void 0,
      "ab1", 1,
      "ab2", 2,
      "ba2", 2
    ]);
  });
});
