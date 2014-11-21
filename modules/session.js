/**
 * @module Session
 * @version v1.00
 * @author Peter Širka
 */

var events = require('events');
var SUGAR = 'XY1';
var USERAGENT = 11;
var VERSION = 'v1.00';

var stats_read = 0;
var stats_write = 0;

function Session() {

    this.options = null;

    /**
     * Read value from session
     * @param {String} id
     * @param {Function(value)} fnCallback
     */
    this.onRead = function(id, fnCallback) {
        var client = redis.createClient();

        client.get('__ssid_' + id, function(err, reply) {
            client.quit();

            fnCallback(reply ? JSON.parse(reply.toString()) : {});
        });
    };

    /**
     * Write value into the session
     * @param {String} id
     * @param {Object} value
     */

    this.onWrite = function (id, value) {
        var client = redis.createClient();
        client.set('__ssid_' + id, JSON.stringify(value));
        client.quit();
    };


}

Session.prototype = new events.EventEmitter();

Session.prototype._read = function(req, res, next) {

    var self = this;
    var id = req.cookie(self.options.cookie) || '';

    if (id.length === 0) {
        self._create(res, req, next);
        return self;
    }

    var obj = framework.decrypt(id, self.options.secret);
    if (obj === null) {
        self._create(res, req, next);
        return self;
    }

    if ('ssid_' + obj.sign !== self._signature(obj.id, req)) {
        self._create(res, req, next);
        return self;
    }

    req._sessionId = obj.id;
    req._session = self;

    stats_read++;

    self.onRead(obj.id, function(session) {
        self.emit('read', req._sessionId, session);
        req.session = session || {};
        next();
    });

    return self;
};

Session.prototype._signature = function(id, req) {
    return id + '|' + req.ip.replace(/\./g, '') + '|' + req.headers['user-agent'].substring(0, USERAGENT).replace(/\s|\./g, '');
};

Session.prototype._create = function(res, req, next) {

    var self = this;
    var id = utils.GUID(10);
    var obj = { id: 'ssid_' + id, sign: self._signature(id, req) };
    var json = framework.encrypt(obj, self.options.secret);

    req._sessionId = obj.id;
    req._session = self;
    req.session = {};

    res.cookie(self.options.cookie, json);
    next();

    return self;
};

Session.prototype._write = function(id, obj) {
    var self = this;

    stats_write++;
    self.emit('write', id, obj);

    if (self.onWrite !== null)
        self.onWrite(id, obj);

    return self;
};

var session = new Session();

module.exports.name = 'session';
module.exports.version = VERSION;
module.exports.instance = session;

module.exports.usage = function() {
    return {
        read: stats_read,
        write: stats_write
    };
};

module.exports.install = function(framework, options) {

    var self = this;

    SUGAR = (framework.config.name + framework.config.version + SUGAR).replace(/\s/g, '');

    session.options = Utils.extend({ cookie: '__ssid_', secret: framework.config.secret, timeout: 15 }, options);

    framework.middleware('session', function(req, res, next) {

        res.once('finish', function() {
            session._write(req._sessionId, req.session);
        });

        session._read(req, res, next);

    });
};

module.exports.uninstall = function(framework, options) {
    framework.removeListener('request', delegate_request);
    framework.uninstall('middleware', 'session');
    session = null;
};
