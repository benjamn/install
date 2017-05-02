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

  it("supports options.fallback.resolve", function () {
    var install = main.makeInstaller({
      fallback: {
        resolve: function (id, parentId, error) {
          if (id === "assert") return id;
          if (id === "path") return "paaath";
          throw error;
        }
      }
    });

    var require = install({
      a: function (require, exports) {
        exports.assertId = require.resolve("assert");
      },

      b: function (r, exports, module) {
        exports.pathId = module.resolve("path");
      }
    });

    assert.strictEqual(require.resolve("assert"), "assert");
    assert.strictEqual(require.resolve("path"), "paaath");

    assert.strictEqual(require("./a").assertId, "assert");
    assert.strictEqual(require("./b").pathId, "paaath");
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

    // Enable Module.prototype.{importSync,export}.
    reify(install.Module);

    var markers = [];

    var require = install({
      a: function (r, exports, module) {
        exports.one = 1;

        (module.importSync ||
         module.import
        ).call(module, "./b", {
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

        (module.importSync ||
         module.import
        ).call(module, "./a", {
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
      "ab2", void 0,
      "ab2", 2,
      "ba2", 2
    ]);
  });

  it("supports options.wrapRequire", function () {
    main.makeInstaller({
      wrapRequire: function (require, parentId) {
        assert.strictEqual(typeof require, "function");
        assert.strictEqual(typeof parentId, "string");

        function wrapper() {
          return require.apply(this, arguments);
        }

        wrapper.parentId = parentId;
        return wrapper;
      }
    })({
      a: function (require, exports, module) {
        assert.strictEqual(require.parentId, module.id);
      }
    })("./a");
  });

  it("supports options.browser", function () {
    var require = main.makeInstaller({
      browser: true
    })({
      a: function (require, exports, module) {
        exports.name = require("./dir").name;
      },
      dir: {
        "package.json": function (require, exports, module) {
          exports.main = "nonexistent";
          exports.browser = "client.js";
        },
        "client.js": function (require, exports, module) {
          exports.name = module.id;
        }
      }
    });

    assert.strictEqual(
      require("./a").name,
      "/dir/client.js"
    );
  });

  it("supports pkg.module", function () {
    function check(makeInstallerOptions) {
      var require = main.makeInstaller(
        makeInstallerOptions
      )({
        a: function (require, exports, module) {
          exports.name = require("./dir").name;
        },
        dir: {
          "package.json": function (require, exports, module) {
            exports.main = "nonexistent";
            exports.module = "client.mjs";
            exports.browser = "client.js";
          },
          "client.mjs": function (require, exports, module) {
            exports.name = module.id;
          },
          "client.js": function (require, exports, module) {
            exports.name = module.id;
          }
        }
      });

      return require("./a");
    }

    assert.strictEqual(
      check({
        browser: true,
        // This option takes precedence over options.browser, so the
        // exports.browser field below will be ignored.
        mainFields: ["module", "main"]
      }).name,
      "/dir/client.mjs"
    );

    assert.strictEqual(
      check({
        mainFields: ["module", "browser", "main"]
      }).name,
      "/dir/client.mjs"
    );

    assert.strictEqual(
      check({
        mainFields: ["browser", "module", "main"]
      }).name,
      "/dir/client.js"
    );

    assert.strictEqual(
      check({
        mainFields: ["module", "browser"]
      }).name,
      "/dir/client.mjs"
    );

    assert.strictEqual(
      check({
        mainFields: ["browser", "module"]
      }).name,
      "/dir/client.js"
    );

    assert.strictEqual(
      check({
        browser: true
      }).name,
      "/dir/client.js"
    );
  });

  it("exposes require.extensions", function () {
    var install = main.makeInstaller({
      extensions: [".js", ".json", ".css"]
    });

    var require = install({
      "a.js": function (require, exports, module) {
        assert.deepEqual(
          require.extensions,
          [".js", ".json", ".css"]
        );

        assert.strictEqual(
          require("./c").name,
          "/c.css"
        );

        exports.name = module.id;
      },

      "c.css": function (require, exports, module) {
        exports.name = module.id;
      }
    });

    install({
      "b.js": function (require, exports, module) {
        assert.deepEqual(
          require.extensions,
          [".js", ".json", ".html"]
        );

        assert.strictEqual(
          require("./c").name,
          "/c.html"
        );

        exports.name = module.id;
      },

      "c.html": function (require, exports, module) {
        exports.name = module.id;
      }
    }, {
      extensions: [".js", ".json", ".html"]
    });

    assert.strictEqual(require("./a").name, "/a.js");
    assert.strictEqual(require("./b").name, "/b.js");
  });

  it("module.children collects package.json modules", function () {
    var require = makeInstaller()({
      "parent.js": function (require, exports, module) {
        assert.deepEqual(module.children, []);

        assert.strictEqual(
          require("./child").name,
          "/child/main.js"
        );

        exports.children = module.children;
      },

      child: {
        "package.json": function (r, exports) {
          exports.main = "main";
        },

        "main.js": function (r, exports, module) {
          exports.name = module.id;
        }
      }
    });

    var ids = require("./parent").children.map(function (child) {
      return child.id;
    });

    assert.deepEqual(ids, [
      "/child/package.json",
      "/child/main.js"
    ]);
  });

  it("module.childrenById collects all children", function () {
    var require = makeInstaller()({
      "parent.js": function (require, exports, module) {
        assert.deepEqual(module.childrenById, {});

        var childId = require("./child").name;
        assert.strictEqual(childId, require.resolve("./child"));
        assert.deepEqual(Object.keys(module.childrenById), [childId]);

        require(module.id);
        assert.deepEqual(
          Object.keys(module.childrenById),
          [childId, module.id]
        );

        assert.deepEqual(module.children, []);
      },

      "child.js": function (require, exports, module) {
        assert.deepEqual(module.childrenById, {});
        require(exports.name = module.id);
        assert.strictEqual(module.childrenById[module.id], module);
        assert.deepEqual(
          Object.keys(module.childrenById),
          [module.id]
        );
      }
    });

    assert.strictEqual(require("./child").name, "/child.js");

    require("./parent");
  });

  it("module.childrenById accounts for aliases", function () {
    var require = makeInstaller()({
      "a.js": function (require, exports, module) {
        assert.deepEqual(Object.keys(module.childrenById), []);
        exports.childName = require("./alias1").name;
        assert.deepEqual(Object.keys(module.childrenById), [
          "/node_modules/one/package.json",
          "/node_modules/two/package.json",
          "/node_modules/two/main.js",
        ]);
      },

      "alias1.js": "one",

      node_modules: {
        one: {
          "package.json": function (r, exports) {
            exports.main = "alias2";
          },

          "alias2.js": "two",
        },

        two: {
          "package.json": function (r, exports) {
            exports.main = "main";
          },

          "main.js": function (r, exports, module) {
            exports.name = module.id;
          }
        }
      }
    });

    assert.strictEqual(
      require("./a").childName,
      "/node_modules/two/main.js"
    );
  });

  it("supports module.exports stubs in array notation", function () {
    var install = makeInstaller();

    install({
      "a.js": function (require, exports) {
        assert.strictEqual(require("b").name, "/node_modules/b/index.js");

        var bPkg = require("b/package");
        assert.deepEqual(bPkg, { main: "index.js" });

        // Now install the "real" package.json module.
        install({
          node_modules: {
            b: {
              "package.json": function (require, exports) {
                // For consistency, if there was a stub, the same object
                // should be used for module.exports when the actual
                // module is first evaluated.
                assert.strictEqual(exports, bPkg);
                exports.version = "1.2.3";
              }
            }
          }
        });

        assert.deepEqual(require("b/package"), {
          main: "index.js",
          version: "1.2.3"
        });
      },

      node_modules: {
        b: {
          // If a module is defined with array notation, and the array
          // contains one or more objects but no functions, then the
          // combined properties of the objects are treated as a temporary
          // stub for module.exports.
          "package.json": [{
            main: "index.js"
          }],

          "index.js": function (r, exports, module) {
            exports.name = module.id;
          }
        }
      }
    })("/a.js");
  });

  function addToTree(tree, id, value) {
    var parts = id.split("/");
    var lastIndex = parts.length - 1;
    parts.forEach(function (part, i) {
      if (part) {
        tree = tree[part] = tree[part] ||
          (i < lastIndex ? Object.create(null) : value);
      }
    });
  }

  it("supports Module.prototype.prefetch and options.prefetch", function () {
    var options = {};
    var install = makeInstaller();

    install.fetch = function (ids) {
      var tree = {};

      Object.keys(ids).forEach(function (id) {
        var info = ids[id];
        assert.strictEqual(info.options, options);
        assert.strictEqual(info.module.id, id);
        addToTree(tree, id, function (r, exports, module) {
          assert.strictEqual(module, info.module);
          exports.name = module.id;
        });
      });

      return tree;
    };

    return install({
      "a.js": function (require, exports, module) {
        module.exports = module.prefetch("./b").then(function (id) {
          assert.strictEqual(id, "/b.js");
          assert.strictEqual(require("./b").name, id);
          assert.strictEqual(require("./c").name, "/c.js");

          assert.strictEqual(
            require("d").name,
            "/node_modules/d/index.js"
          );

          assert.strictEqual(
            require("d/package").name,
            "/node_modules/d/package.json"
          );

          return module.prefetch("./nonexistent").catch(function (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.startsWith("Cannot find module"));
          });
        });
      },

      "b.js": ["./c", "d"],
      "c.js": ["d", "./b"],

      node_modules: {
        d: {
          "package.json": [{
            main: "index"
          }],
          "index.js": []
        }
      }
    }, options)("/a.js");
  });

  it("enforces ordering of module.prefetch promise resolution", function () {
    var install = makeInstaller();
    var bResolve;
    var bPromise = new Promise(function (resolve) {
      bResolve = resolve;
    });

    function exportName(r, exports, module) {
      exports.name = module.id;
    }

    // This install.fetch function always resolves b.js before a.js, even
    // though module.prefetch is called in the other order.
    install.fetch = function (ids) {
      var keys = Object.keys(ids);
      assert.strictEqual(keys.length, 1);

      if (keys[0] === "/a.js") {
        return bPromise.then(function () {
          return { "a.js": exportName };
        });
      }

      if (keys[0] === "/b.js") {
        bResolve({ "b.js": exportName });
        return bPromise;
      }

      throw new Error("unreached");
    };

    var require = install({
      "main.js": function (require, exports, module) {
        var order = [];
        function record(id) {
          order.push(id);
        }

        module.exports = Promise.all([
          module.prefetch("./a").then(record),
          module.prefetch("./b").then(record),
        ]).then(function () {
          assert.deepEqual(order, ["/a.js", "/b.js"]);
          assert.strictEqual(require("./a").name, order[0]);
          assert.strictEqual(require("./b").name, order[1]);
        });
      },
      "a.js": [],
      "b.js": []
    });

    return require("./main");
  });
});
