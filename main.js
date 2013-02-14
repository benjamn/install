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
