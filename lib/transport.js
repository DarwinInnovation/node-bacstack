'use strict';
const os                = require('os');
const _                 = require('underscore');
const createSocket      = require('dgram').createSocket;
const EventEmitter      = require('events').EventEmitter;
const debug             = require('debug')('bacnet:transport:debug');
const trace             = require('debug')('bacnet:transport:trace');

const DEFAULT_BACNET_PORT = 47808;

class Transport extends EventEmitter {
  constructor(settings) {
    super();
    this._lastSendMessages = {};
    this._settings = settings;

    this._ownAddressesByPort = {};
    
    this._socket = createSocket({type: 'udp4', reuseAddr: settings.reuseAddr});

    if (settings.broadcastSocket) {
      this._broadcast_socket = createSocket({type: 'udp4', reuseAddr: true});
    } else {
      this._broadcast_socket = null;
    }
  }

  getBroadcastAddress() {
    return this._settings.broadcastAddress;
  }

  getMaxPayload() {
    return 1482;
  }

  send(buffer, offset, receiver) {
    if (!receiver) {
      receiver = this.getBroadcastAddress();
      const dataToSend = Buffer.alloc(offset);
      // Sort out broadcasted messages that we also receive
      // TODO Find a better way?
      const hrTime = process.hrtime();
      const messageKey = hrTime[0] * 1000000000 + hrTime[1];
      buffer.copy(dataToSend, 0, 0, offset);
      this._lastSendMessages[messageKey] = dataToSend;
      setTimeout(() => {
        delete this._lastSendMessages[messageKey];
      }, 10000); // delete after 10s, hopefully all cases are handled by that
    }
    const [address, port] = receiver.split(':');
    debug('Send packet to ' + receiver + ': ' + buffer.toString('hex').substr(0, offset * 2));
    this._socket.send(buffer, 0, offset, port || DEFAULT_BACNET_PORT, address, (err) => {
      if (err) {
        debug('Send packet to ' + receiver + ' failed: ' + err.message);
      }
      debug('sent');
    });
  }

  open() {
    const skts = [ {skt: this._socket, port: this._settings.port} ];
    let binding_skts = 0;

    if (this._broadcast_socket) {
      skts.push({skt: this._broadcast_socket, port: DEFAULT_BACNET_PORT});
    }

    skts.forEach((skt) => {
      skt.skt.bind(skt.port, this._settings.interface, () => {
        const addr = skt.skt.address();
        skt.skt.setBroadcast(true);
        this._update_ownAddresses(addr);
        debug(`server listening on ${addr.address}:${addr.port}`);
        
        skt.skt.on('message', (msg, rinfo) => {
          this._on_message(skt.skt, msg, rinfo);
        });

        binding_skts -= 1;
        if (binding_skts == 0) {
          this.emit('listening', this.ownAddresses);
        }
      });
      binding_skts += 1;
    
      skt.skt.on('error', (err) => {
        this._on_error(skt.skt, err);
      });
    });


  }

  close() {
    let closing_sockets = 1;

    const on_close =   (skt) => {
      closing_sockets -= 1;
      if (closing_sockets == 0) {
        debug('transport closed');
        this.emit('close');
        // close is to do by the client.close() which calls the transport.close which calls the _server.close
      }
    };

    this._socket.close(on_close);

    if (this._broadcast_socket) {
      closing_sockets += 1;
      this._broadcast_socket.close(on_close);
    }
  }

  _on_message(skt, msg, rinfo) {
          // Check for pot. duplicate messages
      if (rinfo.port in this._ownAddressesByPort) {
        // As the tx and rx sockets are distinct we can easily filter out self-sent messages
        const addresses = this._ownAddressesByPort[rinfo.port].actual;
        if (_.contains(addresses, rinfo.address)) {
              debug(`server IGNORE message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
              return;
        }
      }

      debug(`server got message from ${rinfo.address}:${rinfo.port}: ${msg.toString('hex')}`);
      this.emit('message', msg, rinfo.address + (rinfo.port === DEFAULT_BACNET_PORT ? '' : ':' + rinfo.port));
  }

  _on_error(skt, err) {
    debug('transport error', err.message);
    this.emit('error', err);
  }

  _update_ownAddresses(addr) {
    const ip_addr = addr.address;
    const ip_port = addr.port;

    const addresses = {
      value: ip_addr,
      port: ip_port
    }

    let ip4_addresses = []; 

    if (ip_addr == "0.0.0.0") {
      // Use all possible IP addresses
      const ifaces = os.networkInterfaces();
      
      _.each(ifaces, (iface) => {
        ip4_addresses = _.union(ip4_addresses, iface.reduce((prev, iface_addr) => {
          if (iface_addr.family == "IPv4" ) {
            prev.push(iface_addr.address);
          }
          return prev;
        }, []));
      });
    } else {
      ip4_addresses.push(ip_addr);
    }
    debug('New IP addresses: ', ip4_addresses);

    addresses.actual = ip4_addresses;

    this._ownAddressesByPort[ip_port] = addresses;
  }
}
module.exports = Transport;
