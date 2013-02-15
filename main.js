var fs = require("fs");
var path = require("path");
var file = path.join(__dirname, "install.js");

exports.makeGlobal = function() {
    require("./install");
};

exports.getCode = function(callback) {
    fs.readFile(file, "utf8", callback);
};

exports.getCodeSync = function() {
    return fs.readFileSync(file, "utf8");
};

// Not perfect, but we need to match the behavior of install.js.
var requireExp = /\brequire\(['"]([^'"]+)['"]\)/g;

// This function should match the behavior of `ready` and `absolutize` in
// install.js, but the implementations are not worth unifying because we have
// access to the "path" module here.
exports.getRequiredIDs = function(id, source) {
    var match, seen = {}, ids = [];

    requireExp.lastIndex = 0;
    while ((match = requireExp.exec(source))) {
        var rid = match[1];
        if (rid.charAt(0) === ".")
            rid = path.normalize(path.join(id, "..", match[1]));

        if (!seen.hasOwnProperty(rid)) {
            seen[rid] = true;
            ids.push(rid);
        }
    }

    return ids;
};
