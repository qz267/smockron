var zmq = require('zmq'),
    util = require('util'),
    events = require('events');


module.exports = Smockron;

Smockron.Client = function(opts) {
  events.EventEmitter.call(this);

  this._domain = opts.domain;
  this.server = this._parseConnectionString(opts.server);
  this.socket = {};
};

util.inherits(Smockron.Client, events.EventEmitter);

Smockron.Client.prototype._parseConnectionString = function(connectionString) {
  var m;
  if (connectionString !== undefined
      && (m = connectionString.match(/^(?:(\w+):\/\/)?(.*?)(?::(\d+))?$/))) {
    var scheme = m[1],
        host = m[2],
        port = m[3];
    if (scheme === undefined)
      scheme = 'tcp';
    if (host === undefined)
      throw "Host is required";
    if (port === undefined)
      port = 10004;
    else
      port = parseInt(port, 10);
    return {
      accounting: scheme + '://' + host + ':' + port,
      control: scheme + '://' + host + ':' + (port + 1)
    };
  } else {
    throw "Invalid connection string '" + connectionString + "'";
  }
};

Smockron.Client.prototype.connect = function() {
  this.socket.accounting = zmq.socket('pub');
  this.socket.accounting.connect(this.server.accounting);

  this.socket.control = zmq.socket('sub');
  this.socket.control.connect(this.server.control);
  this.socket.control.subscribe(this._domain);
  this.socket.control.on('message', this._onControl.bind(this));
};

Smockron.Client.prototype._onControl = function() {
  if (controlMsg = this._parseControl(arguments)) {
    this.emit('control', controlMsg);
  }
};

Smockron.Client.prototype._parseControl = function(data) {
  var msg = {};
  if (data.length < 3) {
    console.warn("Too-short control message");
    return;
  }
  try {
    var decoded = Array.prototype.slice.call(data, 0).map(function (buf) { return buf.toString() });
  } catch (e) {
    console.warn("Error decoding buffers", e);
    return;
  }

  var ret = {
    domain: decoded[0],
    command: decoded[1],
    identifier: decoded[2],
    args: decoded.slice(3)
  };
  if (ret.command == 'DELAY_UNTIL') {
    ret.ts = parseFloat(ret.args[0]);
  }
  return ret;
};

Smockron.Client.prototype.sendAccounting = function(opts) {
  var frames = [
    this._domain,
    opts.status,
    opts.identifier,
    opts.rcvTS,
    "",
    ""
  ];
  if (opts.delayTS !== undefined)
    frames[4] = opts.delayTS;
  if (opts.logInfo !== undefined)
    frames[5] = opts.logInfo;
  this.socket.accounting.send(frames);
};

/* END CLIENT */

function Smockron(opts) {
  this.identifierCB = opts.identifierCB;

  this.client = new Smockron.Client({
    domain: opts.domain,
    server: opts.server
  });

  this.client.on('control', this._onControl.bind(this));
  this.client.connect();
};

Smockron.REMOTE_ADDR = function(req) {
  return req.ip;
};

Smockron.prototype._onControl = function(msg) {
  if (msg.command == 'DELAY_UNTIL') {
    this._delayUntil(msg);
  } else {
    console.warn("Control message with unknown command ", msg.command);
    return;
  }
};

Smockron.prototype._delayUntil = function(msg) {
  console.log("Delay", msg.identifier, "until", msg.ts, "for", msg.domain);
};

Smockron.prototype.middleware = function() {
  var self = this;

  return function (req, res, next) {
    var now = (new Date()).getTime();
    var identifier = self.identifierCB(req);
    self.client.sendAccounting({
      status: 'ACCEPTED',
      identifier: identifier,
      rcvTS: now
    });

    setImmediate(next);
  };
};