/**
 * 'mps': MarkPrintServer protocol client.
 * Communicates via TCP/IP with framed protocol (P001 + 4-byte length + payload).
 * Supports BrowseTags for tag browsing and QueryAll/SetUnitVars for polling/writing.
 */

'use strict';

const net = require('net');
const iconv = require('iconv-lite');
const utils = require('../../utils');
const deviceUtils = require('../device-utils');

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------
const FRAME_PREFIX = Buffer.from('P001', 'ascii');  // Framed protocol marker
const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;          // 10 MB max payload
const MAX_ERRORS_COUNT = 2;

// Browse node classes (numeric, matching client NodeType enum)
const NODE_CLASS_OBJECT   = 1;  // expandable folder
const NODE_CLASS_VARIABLE = 2;  // selectable tag with checkbox

// ---------------------------------------------------------------------------
// MPSClient — FUXA driver interface
// ---------------------------------------------------------------------------
function MPSClient(_data, _logger, _events, _runtime) {
    var data = JSON.parse(JSON.stringify(_data));
    var logger = _logger;
    var events = _events;
    var runtime = _runtime;

    // Connection state
    var socket = null;
    var connected = false;
    var working = false;
    var overloading = 0;
    var lastStatus = '';
    var lastTimestampValue = null;
    var errRetryCount = 0;

    // MPS device structure from BrowseTags
    var browseData = null;
    // Cached QueryAll results: { "deviceName": { Units: { u1: { State, Task, Counter, Properties: {...} } } } }
    var deviceStates = {};
    // Tags cache
    var varsValue = {};

    // ── Helper: get connection params ──
    var _getConnParams = function () {
        var prop = data.property || {};
        var address = (prop.address || '127.0.0.1');
        var port = parseInt(prop.port) || 10101;
        var timeout = parseInt(prop.timeout) || 5000;
        return { address, port, timeout };
    };

    // ── Build a single framed buffer: P001 + 4-byte big-endian length + payload ──
    var _buildFrame = function (message) {
        var msgBuf = Buffer.from(message, 'utf8');
        var frame = Buffer.alloc(4 + 4 + msgBuf.length);
        frame[0] = 0x50; frame[1] = 0x30; frame[2] = 0x30; frame[3] = 0x31; // P001
        frame[4] = (msgBuf.length >> 24) & 0xFF;
        frame[5] = (msgBuf.length >> 16) & 0xFF;
        frame[6] = (msgBuf.length >> 8) & 0xFF;
        frame[7] = msgBuf.length & 0xFF;
        msgBuf.copy(frame, 8);
        return frame;
    };

    // ── Send framed message on the main socket and receive framed response ──
    var _sendFramed = function (message) {
        return new Promise((resolve, reject) => {
            if (!socket || socket.destroyed) {
                return reject(new Error('socket not connected'));
            }
            var params = _getConnParams();
            var timeoutMs = params.timeout;
            var responded = false;
            var recvBuffer = Buffer.alloc(0);

            var onData = (chunk) => {
                recvBuffer = Buffer.concat([recvBuffer, chunk]);
                var result = _tryParseFramedResponse(recvBuffer);
                if (result !== null) {
                    responded = true;
                    clearTimeout(timer);
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    resolve(result);
                }
            };

            var onError = (err) => {
                if (!responded) {
                    responded = true;
                    clearTimeout(timer);
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(err);
                }
            };

            var timer = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    socket.removeListener('data', onData);
                    socket.removeListener('error', onError);
                    reject(new Error('timeout'));
                }
            }, timeoutMs);

            socket.on('data', onData);
            socket.on('error', onError);
            socket.write(_buildFrame(message));
        });
    };

    // ── Send framed message on a TEMPORARY socket (for BrowseTags/Healthcheck which close the connection) ──
    var _sendFramedOnTempSocket = function (message) {
        return new Promise((resolve, reject) => {
            var params = _getConnParams();
            var timeoutMs = params.timeout;
            var responded = false;
            var recvBuffer = Buffer.alloc(0);
            var tmpSocket = new net.Socket();
            tmpSocket.setTimeout(timeoutMs);

            var cleanup = function () {
                try { tmpSocket.removeAllListeners(); tmpSocket.destroy(); } catch (e) {}
            };

            var timer = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    cleanup();
                    reject(new Error('timeout'));
                }
            }, timeoutMs);

            tmpSocket.on('data', (chunk) => {
                recvBuffer = Buffer.concat([recvBuffer, chunk]);
                var result = _tryParseFramedResponse(recvBuffer);
                if (result !== null && !responded) {
                    responded = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve(result);
                }
            });

            tmpSocket.on('error', (err) => {
                if (!responded) {
                    responded = true;
                    clearTimeout(timer);
                    cleanup();
                    reject(err);
                }
            });

            tmpSocket.on('close', () => {
                // MPS closes connection after BrowseTags — if we have data, parse it
                if (!responded && recvBuffer.length > 0) {
                    var result = _tryParseFramedResponse(recvBuffer);
                    if (result !== null) {
                        responded = true;
                        clearTimeout(timer);
                        resolve(result);
                        return;
                    }
                }
                if (!responded) {
                    responded = true;
                    clearTimeout(timer);
                    reject(new Error('connection closed before response'));
                }
            });

            tmpSocket.connect(params.port, params.address, () => {
                tmpSocket.write(_buildFrame(message));
            });
        });
    };

    // ── Parse framed response: P001 + 4-byte length + payload ──
    var _tryParseFramedResponse = function (buf) {
        // Need at least prefix(4) + length(4)
        if (buf.length < 8) return null;

        // Check for P001 prefix
        if (buf[0] === 0x50 && buf[1] === 0x30 && buf[2] === 0x30 && buf[3] === 0x31) {
            var payloadLen = (buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7];
            if (payloadLen < 0 || payloadLen > MAX_PAYLOAD_SIZE) {
                return { error: 'invalid frame length: ' + payloadLen };
            }
            if (buf.length < 8 + payloadLen) return null; // need more data
            var payload = buf.slice(8, 8 + payloadLen);
            return { error: null, data: iconv.decode(payload, 'win1251') };
        }

        // No P001 prefix — treat entire buffer as raw response (legacy mode)
        return { error: null, data: iconv.decode(buf, 'win1251') };
    };

    // ── Send command and parse JSON response ──
    var _sendCommand = async function (command) {
        var responseStr = await _sendFramed(command);
        if (responseStr.error) {
            throw new Error(responseStr.error);
        }
        return responseStr.data;
    };

    // ── Send JSON DeviceCommand and parse JSON response ──
    var _sendDeviceCommand = async function (deviceName, command, unit, parameters) {
        var cmd = {
            DeviceName: deviceName,
            Command: command,
            Unit: unit || 0,
            Parameters: parameters || {}
        };
        var jsonStr = JSON.stringify(cmd);
        var responseStr = await _sendCommand(jsonStr);
        try {
            return JSON.parse(responseStr);
        } catch (e) {
            if (responseStr === 'Fail') {
                throw new Error('MPS command failed: ' + command + ' for ' + deviceName);
            }
            throw new Error('Failed to parse MPS response: ' + e.message);
        }
    };

    // ── BrowseTags: get structure of all devices (uses temporary connection) ──
    var _browseTags = async function () {
        var responseObj = await _sendFramedOnTempSocket('BrowseTags');
        if (responseObj.error) {
            throw new Error(responseObj.error);
        }
        try {
            browseData = JSON.parse(responseObj.data);
            return browseData;
        } catch (e) {
            throw new Error('Failed to parse BrowseTags response: ' + e.message);
        }
    };

    // ── QueryAll: get all values for a specific device ──
    var _queryAll = async function (deviceName) {
        var result = await _sendDeviceCommand(deviceName, 'QueryAll', 0, {});
        if (result && result.Units) {
            deviceStates[deviceName] = result;
        }
        return result;
    };

    // ── Resolve tag value from cached device states ──
    // Tag address format: "DeviceName.UnitKey.TagName" or "DeviceName.UnitKey.Properties.PropName"
    var _resolveTagValue = function (tag) {
        var addr = tag.address || tag.name || '';
        var parts = addr.split('.');
        if (parts.length < 3) return undefined;

        var devName = parts[0];
        var unitKey = parts[1];

        var devState = deviceStates[devName];
        if (!devState || !devState.Units) return undefined;

        var unit = devState.Units[unitKey];
        if (!unit) return undefined;

        // Navigate remaining path: e.g. "State" or "Properties.ST"
        var val = unit;
        for (var i = 2; i < parts.length; i++) {
            if (val && typeof val === 'object' && val[parts[i]] !== undefined) {
                val = val[parts[i]];
            } else {
                return undefined;
            }
        }
        return (typeof val !== 'object') ? val : undefined;
    };

    // ── Build browse tree nodes from browseData ──
    var _buildBrowseNodes = function (parentId) {
        var nodes = [];
        if (!browseData || !browseData.Devices) return nodes;

        if (!parentId) {
            // Root level: list all devices
            browseData.Devices.forEach(function (dev) {
                nodes.push({
                    id: dev.Name,
                    name: dev.Name + ' (' + dev.Type + ')',
                    class: NODE_CLASS_OBJECT
                });
            });
            return nodes;
        }

        var parts = parentId.split('.');
        var devName = parts[0];
        var dev = browseData.Devices.find(function (d) { return d.Name === devName; });
        if (!dev) return nodes;

        if (parts.length === 1) {
            // Device level: list units
            if (dev.Units) {
                Object.keys(dev.Units).forEach(function (unitKey) {
                    nodes.push({
                        id: devName + '.' + unitKey,
                        name: unitKey,
                        class: NODE_CLASS_OBJECT
                    });
                });
            }
            return nodes;
        }

        if (parts.length === 2) {
            // Unit level: list built-in tags + Properties folder
            var unitKey = parts[1];
            var unitDef = dev.Units[unitKey];
            if (!unitDef) return nodes;

            // Built-in tags (State, Task, Counter)
            if (unitDef.Tags) {
                unitDef.Tags.forEach(function (tagName) {
                    nodes.push({
                        id: devName + '.' + unitKey + '.' + tagName,
                        name: tagName,
                        class: NODE_CLASS_VARIABLE,
                        type: tagName === 'Counter' ? 'number' : 'string'
                    });
                });
            }
            // Properties folder
            if (unitDef.Properties && unitDef.Properties.length > 0) {
                nodes.push({
                    id: devName + '.' + unitKey + '.Properties',
                    name: 'Properties',
                    class: NODE_CLASS_OBJECT
                });
            }
            return nodes;
        }

        if (parts.length === 3 && parts[2] === 'Properties') {
            // Properties level: list all property names
            var unitKey2 = parts[1];
            var unitDef2 = dev.Units[unitKey2];
            if (!unitDef2 || !unitDef2.Properties) return nodes;

            unitDef2.Properties.forEach(function (propName) {
                nodes.push({
                    id: devName + '.' + unitKey2 + '.Properties.' + propName,
                    name: propName,
                    class: NODE_CLASS_VARIABLE,
                    type: 'string'
                });
            });
            return nodes;
        }

        return nodes;
    };

    // =====================================================================
    // FUXA Driver Interface
    // =====================================================================

    this.init = function (_type) {
        // No subtypes for MPS
    };

    /**
     * Connect to MarkPrintServer
     */
    this.connect = function () {
        return new Promise(async (resolve, reject) => {
            if (!_checkWorking(true)) return reject(new Error('busy'));
            try {
                var params = _getConnParams();
                logger.info(`'${data.name}' try to connect ${params.address}:${params.port}`, true);

                // TCP connect
                socket = new net.Socket();
                socket.setTimeout(params.timeout);

                await new Promise((res, rej) => {
                    var connectTimeout = setTimeout(() => {
                        socket.destroy();
                        rej(new Error('connection timeout'));
                    }, params.timeout);

                    socket.connect(params.port, params.address, () => {
                        clearTimeout(connectTimeout);
                        res();
                    });
                    socket.once('error', (err) => {
                        clearTimeout(connectTimeout);
                        rej(err);
                    });
                });

                // Install persistent error handler for socket lifecycle
                socket.on('error', (err) => {
                    logger.error(`'${data.name}' socket error: ${err.message}`);
                });

                connected = true;
                errRetryCount = 0;
                _emitStatus('connect-ok');
                logger.info(`'${data.name}' connected!`, true);
                _checkWorking(false);
                resolve();
            } catch (err) {
                connected = false;
                _emitStatus('connect-error');
                _clearVarsValue();
                _checkWorking(false);
                if (socket) {
                    try { socket.removeAllListeners(); socket.destroy(); } catch (e) {}
                    socket = null;
                }
                logger.error(`'${data.name}' connect failed! ${err}`);
                reject(err);
            }
        });
    };

    /**
     * Disconnect from MarkPrintServer
     */
    this.disconnect = function () {
        return new Promise(async (resolve) => {
            try {
                _checkWorking(false);
                if (socket) {
                    // Send Close command (best effort)
                    try {
                        socket.write(FRAME_PREFIX);
                        var closeBuf = Buffer.from('Close', 'ascii');
                        var lenBuf = Buffer.alloc(4);
                        lenBuf[0] = (closeBuf.length >> 24) & 0xFF;
                        lenBuf[1] = (closeBuf.length >> 16) & 0xFF;
                        lenBuf[2] = (closeBuf.length >> 8) & 0xFF;
                        lenBuf[3] = closeBuf.length & 0xFF;
                        socket.write(lenBuf);
                        socket.write(closeBuf);
                    } catch (e) {}
                    socket.removeAllListeners();
                    try { socket.destroy(); } catch (e) {}
                }
            } catch (e) {
                logger.error(`'${data.name}' disconnect failure! ${e}`);
            } finally {
                socket = null;
                connected = false;
                errRetryCount = 0;
                browseData = null;
                deviceStates = {};
                _emitStatus('connect-off');
                _clearVarsValue();
                resolve(true);
            }
        });
    };

    /**
     * Polling: read all tag values from MPS devices
     */
    this.polling = async function () {
        if (!_checkWorking(true)) return;
        try {
            if (!socket || !connected || socket.destroyed) {
                _checkWorking(false);
                return;
            }

            // Get unique device names from configured tags
            var deviceNames = {};
            for (var id in data.tags) {
                var tag = data.tags[id];
                var addr = tag.address || tag.name || '';
                var devName = addr.split('.')[0];
                if (devName) {
                    deviceNames[devName] = true;
                }
            }

            // Query each device
            var queryErrors = 0;
            for (var dn in deviceNames) {
                try {
                    await _queryAll(dn);
                } catch (err) {
                    queryErrors++;
                }
            }
            if (queryErrors > 0) {
                logger.warn(`'${data.name}' QueryAll failed for ${queryErrors} device(s)`);
            }

            var timestamp = Date.now();
            var changed = {};

            for (var id in data.tags) {
                var tag = data.tags[id];
                try {
                    var rawValue = _resolveTagValue(tag);
                    if (rawValue === undefined) continue;

                    var value = await deviceUtils.tagValueCompose(
                        rawValue,
                        varsValue[id] ? varsValue[id].value : null,
                        tag,
                        runtime
                    );

                    var tagChanged = !varsValue[id] || varsValue[id].value !== value;

                    varsValue[id] = {
                        id: id,
                        value: value,
                        rawValue: rawValue,
                        type: tag.type,
                        changed: tagChanged,
                        timestamp: timestamp,
                        daq: tag.daq
                    };

                    if (this.addDaq && deviceUtils.tagDaqToSave(varsValue[id], timestamp)) {
                        changed[id] = varsValue[id];
                    }
                    varsValue[id].changed = false;
                } catch (err) {
                    logger.error(`'${data.name}' read tag ${tag.name} error: ${err}`);
                }
            }

            lastTimestampValue = timestamp;
            errRetryCount = 0;
            _emitValues(varsValue);

            if (this.addDaq && !utils.isEmptyObject(changed)) {
                this.addDaq(changed, data.name, data.id);
            }

            if (lastStatus !== 'connect-ok') {
                _emitStatus('connect-ok');
            }
        } catch (err) {
            errRetryCount++;
            if (errRetryCount >= MAX_ERRORS_COUNT) {
                connected = false;
                _emitStatus('connect-error');
            }
            logger.error(`'${data.name}' polling error: ${err}`);
        } finally {
            _checkWorking(false);
        }
    };

    /**
     * Load tags configuration
     */
    this.load = function (_data) {
        data = JSON.parse(JSON.stringify(_data));
        varsValue = {};
        var count = Object.keys(data.tags || {}).length;
        logger.info(`'${data.name}' data loaded (${count})`, true);
    };

    /**
     * Return all current tag values
     */
    this.getValues = function () {
        return varsValue;
    };

    /**
     * Return single tag value with timestamp
     */
    this.getValue = function (id) {
        if (varsValue[id]) {
            return { id: id, value: varsValue[id].value, ts: lastTimestampValue };
        }
        return null;
    };

    /**
     * Return connection status
     */
    this.getStatus = function () {
        return lastStatus;
    };

    /**
     * Return tag property for frontend
     */
    this.getTagProperty = function (id) {
        if (data.tags && data.tags[id]) {
            var t = data.tags[id];
            return { id: id, name: t.name, type: t.type, format: t.format };
        }
        return null;
    };

    /**
     * Write tag value to MPS device via SetUnitVars command
     */
    this.setValue = async function (id, value) {
        if (!socket || !connected) return false;
        try {
            var tag = data.tags[id];
            if (!tag) return false;

            var raw = await deviceUtils.tagRawCalculator(value, tag, runtime);
            var addr = tag.address || tag.name || '';
            var parts = addr.split('.');
            // Address format: DeviceName.UnitKey.Properties.PropName or DeviceName.UnitKey.TagName
            if (parts.length < 3) return false;

            var devName = parts[0];
            var unitKey = parts[1];
            var unitNum = parseInt(unitKey.replace('u', '')) || 0;

            // For built-in tags (State, Task, Counter) — these are typically read-only
            // For properties: DeviceName.UnitKey.Properties.PropName
            var parameters = {};
            if (parts.length >= 4 && parts[2] === 'Properties') {
                parameters[parts[3]] = String(raw);
            } else {
                // Built-in tag like State, Task — try setting as parameter
                parameters[parts[2]] = String(raw);
            }

            await _sendDeviceCommand(devName, 'SetUnitVars', unitNum, parameters);
            logger.info(`'${data.name}' setValue(${tag.name}, ${raw})`, true, true);
            return true;
        } catch (err) {
            logger.error(`'${data.name}' setValue error: ${err}`);
            return false;
        }
    };

    /**
     * Return if device is connected
     */
    this.isConnected = function () {
        return connected && socket && !socket.destroyed;
    };

    /**
     * Browse MPS tags — hierarchical tree.
     * node = null  → root (list of MPS devices)
     * node = { id } → children of that node
     */
    this.browse = function (node, callback) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!socket || !connected) {
                    return resolve([]);
                }

                // Ensure we have browse data
                if (!browseData) {
                    await _browseTags();
                }

                var parentId = (node && node.id) ? node.id : null;
                var nodes = _buildBrowseNodes(parentId);
                resolve(nodes);
            } catch (err) {
                logger.error(`'${data.name}' browse error: ${err}`);
                reject(err);
            }
        });
    };

    /**
     * Bind DAQ store function
     */
    this.bindAddDaq = function (fnc) {
        this.addDaq = fnc;
    };
    this.addDaq = null;

    /**
     * Bind security property accessor
     */
    this.bindGetProperty = function (fnc) {
        this.getProperty = fnc;
    };
    this.getProperty = null;

    /**
     * Return timestamp of last successful read
     */
    this.lastReadTimestamp = () => lastTimestampValue;

    /**
     * Return DAQ settings for tag
     */
    this.getTagDaqSettings = (tagId) => {
        return data.tags && data.tags[tagId] ? data.tags[tagId].daq : null;
    };

    /**
     * Set DAQ settings for tag
     */
    this.setTagDaqSettings = (tagId, settings) => {
        if (data.tags && data.tags[tagId]) {
            utils.mergeObjectsValues(data.tags[tagId].daq, settings);
        }
    };

    // ── Internal helpers ──

    var _emitValues = function (values) {
        events.emit('device-value:changed', { id: data.id, values: values });
    };

    var _emitStatus = function (status) {
        lastStatus = status;
        events.emit('device-status:changed', { id: data.id, status: status });
    };

    var _clearVarsValue = function () {
        for (var id in varsValue) {
            varsValue[id].value = null;
        }
        _emitValues(varsValue);
    };

    var _checkWorking = function (flag) {
        if (flag && working) {
            overloading++;
            if (overloading >= 3) {
                _emitStatus('connect-busy');
                logger.warn(`'${data.name}' working overload! polling too fast`);
                overloading = 0;
            }
            return false;
        }
        working = flag;
        if (!flag) overloading = 0;
        return true;
    };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
module.exports = {
    init: function (settings) { },
    create: function (data, logger, events, manager, runtime) {
        return new MPSClient(data, logger, events, runtime);
    }
};
