(function (global, undefined) {
  if (global.makeInstaller) {
    return;
  }

  function makeInstaller(options) {
    var root = new File({});

    // Set up a simple queue for tracking required modules with unmet
    // dependencies. See also `queueAppend` and `queueFlush`.
    var q = root.q = {};
    q.h = q.t = {}; // Queue head, queue tail.
    // Configurable function for deferring queue flushes.
    q.d = options && options.defer || function (fn) {
      setTimeout(fn, 0);
    };

    return function install(tree) {
      if (isObject(tree)) {
        fileMergeContents(root, tree);
        queueFlush(root.q);
      }
      return root.r;
    };
  }

  global.makeInstaller = makeInstaller;

  if (typeof exports === "object") {
    exports.makeInstaller = makeInstaller;
  }

  var extensions = [".js", ".json"];
  var MISSING = {};
  var hasOwn = MISSING.hasOwnProperty;
  var Ap = Array.prototype;

  function getOwn(obj, key) {
    return hasOwn.call(obj, key) && obj[key];
  }

  function isObject(value) {
    return value && typeof value === "object";
  }

  function isFunction(value) {
    return typeof value === "function";
  }

  function isString(value) {
    return typeof value === "string";
  }

  function queueAppend(q, file) {
    // Property names shortened to shave bytes: `.t` means `.tail`, `.h`
    // means `.head`, `.n` means `.next`, and `.f` means `.file`.
    q.t = q.t.n = { f: file };
    if (q.h.n === q.t) {
      // If the queue contains only one File (the one we just added), go
      // ahead and schedule a flush.
      queueFlush(q);
    }
  }

  function queueFlush(q) {
    // The `q.p` property is set to indicate a flush is pending.
    q.p || (q.p = true, q.d(function () {
      q.p = undefined;
      var next = q.h.n;
      if (next && fileReady(next.f)) {
        queueFlush(q); // Schedule the next flush.
        q.h = next;
        fileEvaluate(next.f);
      }
    }));
  }

  // These `unbound{Require,Ensure}` functions need to be bound to File
  // objects before they can be used. See `makeRequire`.

  function unboundRequire(id) {
    var result = fileEvaluate(fileResolve(this, id));
    if (result === MISSING) {
      throw new Error("Cannot find module '" + id + "'");
    }
    return result;
  }

  function unboundEnsure() {
    // Flatten arguments into an array containing relative module
    // identifier strings and an optional callback function, then coerce
    // that array into a callback function with a `.d` property.
    var flatArgs = Ap.concat.apply(Ap, arguments);
    var callback = ensureObjectOrFunction(flatArgs);

    // Note that `queueAppend` schedules a flush if there are no other
    // callbacks waiting in the queue.
    queueAppend(this.q, new File(callback, this));
  }

  function makeRequire(file) {
    var require = unboundRequire.bind(file);
    require.ensure = unboundEnsure.bind(file);
    // TODO Consider adding `require.promise`.
    return require;
  }

  // File objects represent either directories or modules that have been
  // installed. When a `File` respresents a directory, its `.c` (contents)
  // property is an object containing the names of the files (or
  // directories) that it contains. When a `File` represents a module, its
  // `.c` property is a function that can be invoked with the appropriate
  // `(require, exports, module)` arguments to evaluate the module. The
  // `.p` (parent) property of a File is either a directory `File` or
  // `null`. Note that a child may claim another `File` as its parent even
  // if the parent does not have an entry for that child in its `.c`
  // object.  This is important for implementing anonymous files, and
  // preventing child modules from using `../relative/identifier` syntax
  // to examine unrelated modules.
  function File(contents, /*optional:*/ parent, name) {
    var file = this;

    // Link to the parent file.
    file.p = parent = parent || null;

    // The module object for this File, which will eventually boast an
    // .exports property when/if the file is evaluated.
    file.m = {
      // If this file was created with `name`, join it with `parent.m.id`
      // to generate a module identifier.
      id: name ? (parent && parent.m.id || "") + "/" + name : null
    };

    // Queue for tracking required modules with unmet dependencies,
    // inherited from the `parent`.
    file.q = parent && parent.q;

    // Each directory has its own bound version of the `require` function
    // that can resolve relative identifiers. Non-directory Files inherit
    // the require function of their parent directories, so we don't have
    // to create a new require function every time we evaluate a module.
    file.r = isObject(contents)
      ? makeRequire(file)
      : parent && parent.r;

    // Set the initial value of `file.c` (the "contents" of the File).
    fileMergeContents(file, contents);

    // When the file is a directory, `file.ready` is an object mapping
    // module identifiers to boolean ready statuses. This information can
    // be shared by all files in the directory, because module resolution
    // always has the same results for all files in a given directory.
    file.ready = fileIsDirectory(file) && {};
  }

  // A file is ready if all of its dependencies are installed and ready.
  function fileReady(file) {
    var result = !! file;
    var factory = file && file.c;
    var deps = isFunction(factory) && factory.d;
    if (deps && ! getOwn(factory, "seen")) {
      factory.seen = true;
      var parentReadyCache = file.p.ready;
      result = deps.every(function (dep) {
        // By storing the results of these lookups in `parentReadyCache`,
        // we benefit when any other file in the same directory resolves
        // the same identifier.
        return parentReadyCache[dep] =
          parentReadyCache[dep] ||
          fileReady(fileResolve(file.p, dep));
      });
      factory.seen = undefined;
    }
    return result;
  }

  function fileEvaluate(file) {
    var factory = file && file.c;
    if (isFunction(factory)) {
      var module = file.m;
      if (! hasOwn.call(module, "exports")) {
        factory.call(global, file.r, module.exports = {}, module);
      }
      return module.exports;
    }
    return MISSING;
  }

  function fileIsDirectory(file) {
    return isObject(file.c);
  }

  function fileMergeContents(file, contents) {
    if ((contents = ensureObjectOrFunction(contents))) {
      var fileContents = file.c = file.c || (
        isFunction(contents) ? contents : {}
      );

      if (isObject(contents) && fileIsDirectory(file)) {
        Object.keys(contents).forEach(function (key) {
          var child = getOwn(fileContents, key);
          if (child) {
            fileMergeContents(child, contents[key]);
          } else {
            fileContents[key] = new File(contents[key], file, key);
          }
        });
      }
    }
  };

  function ensureObjectOrFunction(contents) {
    // If contents is an array of strings and functions, return the last
    // function with a `.d` property containing all the strings.
    if (Array.isArray(contents)) {
      var deps = [];
      var func;

      contents.forEach(function (item) {
        if (isString(item)) {
          deps.push(item);
        } else if (isFunction(item)) {
          func = item;
        }
      });

      // If no function was found in the array, provide a default function
      // that simply requires each dependency (really common case).
      contents = func || function (require) {
        deps.forEach(function (key) {
          require.ensure(function () {
            require(key);
          });
        });
      };

      contents.d = deps;

    } else if (isFunction(contents)) {
      // If contents is already a function, make sure it has deps.
      contents.d = contents.d || [];

    } else if (! isObject(contents)) {
      // If contents is neither an array nor a function nor an object,
      // just give up and return null.
      contents = null;
    }

    return contents;
  }

  function fileAppendIdPart(file, part, isLastPart) {
    // Always append relative to a directory.
    while (file && ! fileIsDirectory(file)) {
      file = file.p;
    }

    if (! file || ! part || part === ".") {
      return file;
    }

    if (part === "..") {
      return file.p;
    }

    var exactChild = getOwn(file.c, part);

    // Only consider multiple file extensions if this part is the last
    // part of a module identifier and not equal to `.` or `..`, and there
    // was no exact match or the exact match was a directory.
    if (isLastPart && (! exactChild || fileIsDirectory(exactChild))) {
      for (var e = 0; e < extensions.length; ++e) {
        var child = getOwn(file.c, part + extensions[e]);
        if (child) {
          return child;
        }
      }
    }

    return exactChild;
  };

  function fileAppendId(file, id) {
    var parts = id.split("/");
    // Use `Array.prototype.every` to terminate iteration early if
    // `fileAppendIdPart` returns a falsy value.
    parts.every(function (part, i) {
      return file = fileAppendIdPart(file, part, i === parts.length - 1);
    });
    return file;
  };

  function fileGetRoot(file) {
    return file && fileGetRoot(file.p) || file;
  }

  function fileResolve(file, id) {
    file =
      // Absolute module identifiers (i.e. those that begin with a `/`
      // character) are interpreted relative to the root directory, which
      // is a slight deviation from Node, which has access to the entire
      // file system.
      id.charAt(0) === "/" ? fileAppendId(fileGetRoot(file), id) :
      // Relative module identifiers are interpreted relative to the
      // current file, naturally.
      id.charAt(0) === "." ? fileAppendId(file, id) :
      // Top-level module identifiers are interpreted as referring to
      // packages in `node_modules` directories.
      nodeModulesLookup(file, id);

    // If the identifier resolves to a directory, we use the same logic as
    // Node to find an `index.js` or `package.json` file to evaluate.
    while (file && fileIsDirectory(file)) {
      // If `package.json` does not exist, `fileEvaluate` will return the
      // `MISSING` object, which has no `.main` property.
      var pkg = fileEvaluate(fileAppendIdPart(file, "package.json"));
      file = pkg && isString(pkg.main) &&
        fileAppendId(file, pkg.main) || // Might resolve to another directory!
        fileAppendIdPart(file, "index.js");
    }

    return file;
  };

  function nodeModulesLookup(file, id) {
    return fileIsDirectory(file) &&
      fileAppendId(file, "node_modules/" + id) ||
      (file.p && nodeModulesLookup(file.p, id));
  }
})("object" === typeof global ? global :
   "object" === typeof window ? window :
   "object" === typeof self ? self : this);
